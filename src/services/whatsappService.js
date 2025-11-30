const { default: makeWASocket, DisconnectReason } = require('@whiskeysockets/baileys');
const useFirebaseAuthState = require('./firebaseAuthState');
const aiService = require('./aiService');
const pino = require('pino');

const sessions = new Map(); // userId -> { sock, qr, status, retryCount }

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
        }
    });

    sock.ev.on('messages.upsert', async m => {
        const msg = m.messages[0];
        if (!msg.key.fromMe && m.type === 'notify') {
            const messageContent = msg.message?.conversation || msg.message?.extendedTextMessage?.text;
            if (messageContent) {
                try {
                    // Generate AI response with user context
                    const response = await aiService.generateResponse(messageContent, userId);
                    await sock.sendMessage(msg.key.remoteJid, { text: response });
                } catch (error) {
                    console.error(`User ${userId}: Error processing message:`, error);
                }
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

module.exports = {
    initialize,
    getQR,
    getStatus
};
