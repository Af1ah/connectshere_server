const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const useFirebaseAuthState = require('./firebaseAuthState');
const aiService = require('./aiService');
const firebaseService = require('./firebaseService');
const pino = require('pino');

const sessions = new Map(); // userId -> { sock, qr, status, retryCount }

const processMessage = async (sock, msg, userId) => {
    const messageContent = msg.message?.conversation || msg.message?.extendedTextMessage?.text;
    if (!messageContent) return;

    try {
        // Send read receipt (blue tick) when starting to process
        await sock.readMessages([msg.key]);

        // Show typing indicator while generating response
        await sock.sendPresenceUpdate('composing', msg.key.remoteJid);

        // Extract sender's phone number
        // Handle different formats: @s.whatsapp.net, @g.us (groups), @lid (linked ID)
        let senderPhone = 'Unknown';
        const remoteJid = msg.key.remoteJid || '';

        // For @lid format or groups, try to get actual phone from participant
        if (msg.key.participant) {
            senderPhone = msg.key.participant.replace('@s.whatsapp.net', '').replace('@lid', '');
        } else if (remoteJid.includes('@s.whatsapp.net')) {
            senderPhone = remoteJid.replace('@s.whatsapp.net', '');
        } else if (remoteJid.includes('@lid')) {
            // LID format - use as-is or extract number portion
            senderPhone = remoteJid.replace('@lid', '');
        } else {
            senderPhone = remoteJid.split('@')[0];
        }

        // Generate AI response with sender phone for booking context
        const response = await aiService.generateResponse(messageContent, userId, senderPhone);

        // Determine if we should quote/reply to the message
        const shouldQuote = aiService.shouldReplyToMessage(messageContent);

        // Send the response
        const messageOptions = {
            text: response
        };

        // Add quoted message if contextually appropriate
        if (shouldQuote) {
            messageOptions.quoted = msg;
        }

        await sock.sendMessage(msg.key.remoteJid, messageOptions);

        // Stop typing indicator
        await sock.sendPresenceUpdate('paused', msg.key.remoteJid);

        // Message delivery status (double tick) is automatically handled by Baileys

    } catch (error) {
        console.error(`User ${userId}: Error processing message:`, error);
        // Stop typing on error
        await sock.sendPresenceUpdate('paused', msg.key.remoteJid).catch(() => { });
    }
};

const processQueuedMessages = async (userId) => {
    const session = sessions.get(userId);
    if (!session || session.status !== 'connected') return;

    console.log(`User ${userId}: Processing queued messages...`);

    const queuedMessages = await firebaseService.getQueuedMessages(userId);

    for (const queuedMsg of queuedMessages) {
        try {
            await processMessage(session.sock, queuedMsg.message, userId);
            await firebaseService.clearQueuedMessage(userId, queuedMsg.id);
            console.log(`User ${userId}: Processed queued message ${queuedMsg.id}`);
        } catch (error) {
            console.error(`User ${userId}: Error processing queued message:`, error);
        }
    }
};

const initialize = async (userId) => {
    const session = sessions.get(userId);
    if (session && ['connected', 'connecting', 'scanning'].includes(session.status)) {
        return;
    }

    const { state, saveCreds } = await useFirebaseAuthState(userId);

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        connectTimeoutMs: 60000,
        retryRequestDelayMs: 2000,
    });

    // Initialize session state
    sessions.set(userId, { sock, qr: null, status: 'connecting', retryCount: 0 });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        const session = sessions.get(userId);

        if (qr) {
            session.qr = qr;
            session.status = 'scanning';
            sessions.set(userId, session);
        }

        if (connection === 'close') {
            const statusCode = (lastDisconnect.error)?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut && statusCode !== 408;

            console.log(`User ${userId}: connection closed due to `, lastDisconnect.error, ', reconnecting ', shouldReconnect);

            session.status = 'disconnected';
            session.qr = null;
            sessions.set(userId, session);

            if (shouldReconnect) {
                // Exponential backoff or simple delay
                setTimeout(() => {
                    initialize(userId);
                }, 5000);
            } else {
                // Clean up if logged out or QR timed out
                if (statusCode === 408) {
                    console.log(`User ${userId}: QR scan timed out. Please try again.`);
                }
                sessions.delete(userId);
            }
        } else if (connection === 'open') {
            console.log(`User ${userId}: opened connection`);
            session.status = 'connected';
            session.qr = null;
            session.retryCount = 0;
            sessions.set(userId, session);

            // Process any queued messages from when bot was offline
            await processQueuedMessages(userId);
        }
    });

    sock.ev.on('messages.upsert', async m => {
        const msg = m.messages[0];
        if (!msg.key.fromMe && m.type === 'notify') {
            const session = sessions.get(userId);

            // If bot is connected, process immediately
            if (session && session.status === 'connected') {
                await processMessage(sock, msg, userId);
            } else {
                // Queue message for later processing
                console.log(`User ${userId}: Bot offline, queuing message...`);
                await firebaseService.queueMessage(userId, {
                    message: msg,
                    remoteJid: msg.key.remoteJid
                });
            }
        }
    });
};

const getQR = (userId) => {
    return sessions.get(userId)?.qr || null;
};

const getStatus = (userId) => {
    return sessions.get(userId)?.status || 'disconnected';
};

const disconnect = async (userId) => {
    const session = sessions.get(userId);
    if (session && session.sock) {
        try {
            // Close the socket connection
            session.sock.end();
            console.log(`User ${userId}: WhatsApp connection closed`);
        } catch (error) {
            console.error(`User ${userId}: Error closing connection:`, error);
        }
    }
    // Remove the session from the map
    sessions.delete(userId);
    console.log(`User ${userId}: Session removed from memory`);
};

const clearCredentials = async (userId) => {
    const { db } = require('../config/firebase');
    const { collection, getDocs, deleteDoc } = require('firebase/firestore');

    // First disconnect if connected
    await disconnect(userId);

    try {
        // Get all documents in the whatsapp_creds subcollection
        const credsCollectionRef = collection(db, 'users', userId, 'whatsapp_creds');
        const snapshot = await getDocs(credsCollectionRef);

        // Delete each document
        const deletePromises = snapshot.docs.map(doc => deleteDoc(doc.ref));
        await Promise.all(deletePromises);

        console.log(`User ${userId}: Cleared ${snapshot.docs.length} credential documents from Firebase`);
        return { deleted: snapshot.docs.length };
    } catch (error) {
        console.error(`User ${userId}: Error clearing credentials:`, error);
        throw error;
    }
};

module.exports = {
    initialize,
    getQR,
    getStatus,
    disconnect,
    clearCredentials
};
