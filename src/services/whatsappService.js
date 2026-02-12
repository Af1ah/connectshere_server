const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@rexxhayanasi/elaina-baileys');
const useFirebaseAuthState = require('./firebaseAuthState');
const aiService = require('./aiService');
const firebaseService = require('./firebaseService');
const bookingState = require('./bookingStateManager');
const pino = require('pino');

const sessions = new Map(); // userId -> { sock, qr, status, retryCount }

const getConversationKey = (senderPhone) => `wa_${String(senderPhone || 'unknown').replace(/[^0-9a-zA-Z_-]/g, '')}`;
const getBookingKey = (userId, senderPhone) => `${userId}::${getConversationKey(senderPhone)}`;

/**
 * Send a message with interactive buttons
 */
const sendButtonMessage = async (sock, jid, text, footer = '', buttons = []) => {
    const formattedButtons = buttons.map((btn, index) => ({
        buttonId: btn.id || `btn_${index}`,
        buttonText: { displayText: btn.text },
        type: 1
    }));

    await sock.sendMessage(jid, {
        text,
        footer,
        buttons: formattedButtons,
        headerType: 1
    });
};

/**
 * Send a list message with options
 */
const sendListMessage = async (sock, jid, text, buttonText, sections) => {
    await sock.sendMessage(jid, {
        text,
        buttonText,
        sections,
        footer: 'ConnectSphere Bot'
    });
};

/**
 * Send date selection buttons
 */
const sendDateButtons = async (sock, jid, userId) => {
    const consultantService = require('./consultantService');
    const dates = await consultantService.getNextAvailableDates(userId, 3);

    if (dates.length === 0) {
        await sock.sendMessage(jid, { text: "Sorry, no available slots right now. Please try again later." });
        return;
    }

    const buttons = dates.map(d => ({
        id: `date_${d.date}`,
        text: `${d.dayName.charAt(0).toUpperCase() + d.dayName.slice(1)} (${d.date.slice(5)})`
    }));

    await sendButtonMessage(sock, jid,
        "📅 *Select a date:*",
        `${dates[0].availableSlots}+ slots available`,
        buttons
    );
};

/**
 * Send time slot buttons for a date
 */
const sendTimeSlotButtons = async (sock, jid, userId, date) => {
    const consultantService = require('./consultantService');
    const result = await consultantService.getAvailableSlots(userId, date);

    if (!result.available || result.slots.length === 0) {
        await sock.sendMessage(jid, { text: "No available slots for this date. Please select another date." });
        await sendDateButtons(sock, jid, userId);
        return;
    }

    // Take first 3 slots (WhatsApp button limit)
    const slots = result.slots.slice(0, 3);
    const buttons = slots.map(s => ({
        id: `slot_${s}`,
        text: `🕐 ${s}`
    }));

    await sendButtonMessage(sock, jid,
        `⏰ *Available times for ${date}:*\n\n${result.slots.length} slots available`,
        'Select a time',
        buttons
    );
};

/**
 * Send booking confirmation buttons
 */
const sendConfirmationButtons = async (sock, jid, phone, date, timeSlot, reason, name) => {
    const buttons = [
        { id: `confirm_yes`, text: '✅ Confirm Booking' },
        { id: `cancel_booking`, text: '❌ Cancel' }
    ];

    await sendButtonMessage(sock, jid,
        `📋 *Confirm your booking:*\n\n👤 Name: ${name}\n📅 Date: ${date}\n⏰ Time: ${timeSlot}\n📝 Reason: ${reason || 'General'}`,
        'Tap to confirm or cancel',
        buttons
    );
};

/**
 * Handle booking button interactions
 */
const handleBookingButton = async (sock, jid, userId, bookingKey, phone, buttonId) => {
    const action = bookingState.parseButtonAction(buttonId);
    if (!action) return false;

    const consultantService = require('./consultantService');
    const state = bookingState.getState(bookingKey);

    switch (action.type) {
        case 'date':
            bookingState.setDate(bookingKey, action.value);
            await sendTimeSlotButtons(sock, jid, userId, action.value);
            return true;

        case 'slot':
            bookingState.setTimeSlot(bookingKey, action.value);
            // Ask for name instead of showing confirmation
            await sock.sendMessage(jid, {
                text: '👤 *Please enter your name:*\n\n_Just type your name to continue..._'
            });
            return true;

        case 'confirm':
            const currentState = bookingState.getState(bookingKey);
            if (!currentState.name) {
                await sock.sendMessage(jid, { text: '👤 Please share your name first.' });
                return true;
            }
            if (!currentState.reason) {
                await sock.sendMessage(jid, { text: '📝 Please share the reason for consultation first.' });
                return true;
            }
            const result = await consultantService.createBooking(userId, {
                phone,
                name: currentState.name || 'WhatsApp Customer',
                reason: currentState.reason,
                date: currentState.date,
                timeSlot: currentState.timeSlot
            });

            if (result.success) {
                await sock.sendMessage(jid, {
                    text: `✅ *Booking Confirmed!*\n\n👤 Name: ${currentState.name}\n🎫 Token: #${result.tokenNumber}\n📅 ${currentState.date}\n⏰ ${currentState.timeSlot}\n\nYou'll receive a confirmation soon!`
                });
            } else {
                await sock.sendMessage(jid, { text: `❌ ${result.error}` });
            }
            bookingState.clearState(bookingKey);
            return true;

        case 'cancel':
            bookingState.clearState(bookingKey);
            await sock.sendMessage(jid, { text: "Booking cancelled. Let me know if you need anything else!" });
            return true;
    }

    return false;
};

/**
 * Handle text input during booking flow (e.g., name entry)
 */
const handleBookingTextInput = async (sock, jid, userId, bookingKey, phone, text) => {
    const state = bookingState.getState(bookingKey);

    if (state.step === bookingState.BOOKING_STEPS.AWAITING_REASON) {
        const reason = text.trim();
        if (reason.length < 3) {
            await sock.sendMessage(jid, { text: '📝 Please provide a short reason (at least 3 characters).' });
            return true;
        }
        bookingState.setState(bookingKey, {
            step: bookingState.BOOKING_STEPS.AWAITING_DATE,
            reason
        });
        await sendDateButtons(sock, jid, userId);
        return true;
    }

    if (state.step === bookingState.BOOKING_STEPS.AWAITING_NAME) {
        // User entered their name
        bookingState.setName(bookingKey, text.trim());
        const updatedState = bookingState.getState(bookingKey);

        if (!updatedState.reason) {
            bookingState.setState(bookingKey, {
                step: bookingState.BOOKING_STEPS.AWAITING_REASON
            });
            await sock.sendMessage(jid, {
                text: '📝 *Please share reason for consultation:*'
            });
            return true;
        }

        // Show confirmation with name
        await sendConfirmationButtons(sock, jid, phone, updatedState.date, updatedState.timeSlot, updatedState.reason, updatedState.name);
        return true;
    }

    return false;
};

const processMessage = async (sock, msg, userId) => {
    // Handle button responses
    const buttonResponse = msg.message?.buttonsResponseMessage?.selectedButtonId;
    const listResponse = msg.message?.listResponseMessage?.singleSelectReply?.selectedRowId;

    const messageContent =
        buttonResponse ||
        listResponse ||
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text;

    if (!messageContent) return;

    try {
        await sock.readMessages([msg.key]);
        await sock.sendPresenceUpdate('composing', msg.key.remoteJid);

        // Extract sender's phone number
        let senderPhone = 'Unknown';
        const senderName = msg.pushName || msg.message?.extendedTextMessage?.contextInfo?.participant || null;
        const remoteJid = msg.key.remoteJid || '';

        if (msg.key.participant) {
            senderPhone = msg.key.participant.replace('@s.whatsapp.net', '').replace('@lid', '');
        } else if (remoteJid.includes('@s.whatsapp.net')) {
            senderPhone = remoteJid.replace('@s.whatsapp.net', '');
        } else if (remoteJid.includes('@lid')) {
            senderPhone = remoteJid.replace('@lid', '');
        } else {
            senderPhone = remoteJid.split('@')[0];
        }

        const conversationKey = getConversationKey(senderPhone);
        const bookingKey = getBookingKey(userId, senderPhone);

        // Check if this is a booking button response
        if (bookingState.isBookingAction(messageContent)) {
            const handled = await handleBookingButton(sock, remoteJid, userId, bookingKey, senderPhone, messageContent);
            if (handled) {
                await sock.sendPresenceUpdate('paused', remoteJid);
                return;
            }
        }

        // Check if user is in a booking flow and typing text (e.g., name)
        const textHandled = await handleBookingTextInput(sock, remoteJid, userId, bookingKey, senderPhone, messageContent);
        if (textHandled) {
            await sock.sendPresenceUpdate('paused', remoteJid);
            return;
        }

        // Generate AI response
        const response = await aiService.generateResponse(messageContent, userId, senderPhone, senderName, conversationKey);

        // Check for booking trigger in AI response
        // Format: [BOOKING:start] or [BOOKING:dates]
        const bookingMatch = response.match(/\[BOOKING:(\w+)\]/);

        if (bookingMatch) {
            const action = bookingMatch[1];
            const cleanText = response.replace(/\[BOOKING:\w+\]/, '').trim();

            if (cleanText) {
                await sock.sendMessage(remoteJid, { text: cleanText });
            }

            if (action === 'dates') {
                // Start booking flow with date selection
                bookingState.startBooking(bookingKey, null);
                await sock.sendMessage(remoteJid, {
                    text: '📝 *What is the reason for consultation?*'
                });
            }

            await sock.sendPresenceUpdate('paused', remoteJid);
            return;
        }

        // Check for button markers
        const buttonMatch = response.match(/\[BUTTONS:(.+?)\]/);

        if (buttonMatch) {
            const buttonTexts = buttonMatch[1].split('|');
            const cleanText = response.replace(/\[BUTTONS:.+?\]/, '').trim();

            const buttons = buttonTexts.map((text, i) => ({
                id: `option_${i + 1}`,
                text: text.trim()
            }));

            await sendButtonMessage(sock, remoteJid, cleanText, 'ConnectSphere', buttons);
        } else {
            // Send regular text message
            const shouldQuote = aiService.shouldReplyToMessage(messageContent);
            const messageOptions = { text: response };
            if (shouldQuote) messageOptions.quoted = msg;
            await sock.sendMessage(remoteJid, messageOptions);
        }

        await sock.sendPresenceUpdate('paused', remoteJid);

    } catch (error) {
        console.error(`User ${userId}: Error processing message:`, error);
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

const clearReconnectTimer = (session) => {
    if (session && session.reconnectTimer) {
        clearTimeout(session.reconnectTimer);
        session.reconnectTimer = null;
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
    sessions.set(userId, {
        sock,
        qr: null,
        status: 'connecting',
        retryCount: 0,
        manualDisconnect: false,
        reconnectTimer: null
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        const session = sessions.get(userId);
        if (!session) return;

        if (qr) {
            session.qr = qr;
            session.status = 'scanning';
            sessions.set(userId, session);
        }

        if (connection === 'close') {
            const statusCode = (lastDisconnect.error)?.output?.statusCode;
            const shouldReconnect =
                !session.manualDisconnect &&
                statusCode !== DisconnectReason.loggedOut &&
                statusCode !== 408;

            console.log(`User ${userId}: connection closed due to `, lastDisconnect.error, ', reconnecting ', shouldReconnect);

            session.status = 'disconnected';
            session.qr = null;
            sessions.set(userId, session);

            if (shouldReconnect) {
                clearReconnectTimer(session);
                session.reconnectTimer = setTimeout(() => {
                    const latest = sessions.get(userId);
                    if (latest) {
                        latest.reconnectTimer = null;
                        latest.manualDisconnect = false;
                        sessions.set(userId, latest);
                    }
                    initialize(userId);
                }, 5000);
                sessions.set(userId, session);
            } else {
                clearReconnectTimer(session);
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

            if (session && session.status === 'connected') {
                await processMessage(sock, msg, userId);
            } else {
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
            session.manualDisconnect = true;
            clearReconnectTimer(session);
            sessions.set(userId, session);
            session.sock.end();
            console.log(`User ${userId}: WhatsApp connection closed`);
        } catch (error) {
            console.error(`User ${userId}: Error closing connection:`, error);
        }
    }
    sessions.delete(userId);
    console.log(`User ${userId}: Session removed from memory`);
};

const clearCredentials = async (userId) => {
    const { db } = require('../config/firebase');
    const { collection, getDocs, deleteDoc } = require('firebase/firestore');

    await disconnect(userId);

    try {
        const credsCollectionRef = collection(db, 'users', userId, 'whatsapp_creds');
        const snapshot = await getDocs(credsCollectionRef);

        const deletePromises = snapshot.docs.map(doc => deleteDoc(doc.ref));
        await Promise.all(deletePromises);

        console.log(`User ${userId}: Cleared ${snapshot.docs.length} credential documents from Firebase`);
        return { deleted: snapshot.docs.length };
    } catch (error) {
        console.error(`User ${userId}: Error clearing credentials:`, error);
        throw error;
    }
};

/**
 * Send a test button message (for testing purposes)
 * @param {string} userId - User ID
 * @param {string} phone - Phone number with country code (e.g., 919876543210)
 */
const sendTestButtons = async (userId, phone) => {
    const session = sessions.get(userId);
    if (!session || session.status !== 'connected') {
        throw new Error('WhatsApp not connected');
    }

    const jid = `${phone}@s.whatsapp.net`;

    await sendButtonMessage(
        session.sock,
        jid,
        'Welcome! How can I help you today?',
        'ConnectSphere Bot',
        [
            { id: 'book', text: '📅 Book Appointment' },
            { id: 'faq', text: '❓ FAQ' },
            { id: 'support', text: '💬 Contact Support' }
        ]
    );
};

/**
 * Get session for a user (for external services)
 */
const getSession = (userId) => {
    return sessions.get(userId);
};

module.exports = {
    initialize,
    getQR,
    getStatus,
    disconnect,
    clearCredentials,
    sendButtonMessage,
    sendListMessage,
    sendTestButtons,
    getSession
};
