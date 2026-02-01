/**
 * Booking Notification Service
 * Sends WhatsApp notifications with QR codes for confirmed bookings
 */

const QRCode = require('qrcode');
const whatsappService = require('./whatsappService');

/**
 * Generate QR code as base64 buffer for booking
 */
const generateBookingQR = async (bookingData) => {
    const { tokenNumber, name, date, timeSlot, reason, bookingId } = bookingData;

    // Create QR code content (can be scanned by staff to verify)
    const qrContent = JSON.stringify({
        id: bookingId,
        token: tokenNumber,
        name,
        date,
        time: timeSlot,
        reason
    });

    // Generate QR as buffer
    const qrBuffer = await QRCode.toBuffer(qrContent, {
        type: 'png',
        width: 300,
        margin: 2,
        color: {
            dark: '#000000',
            light: '#FFFFFF'
        }
    });

    return qrBuffer;
};

/**
 * Send booking confirmation notification with QR code
 */
const sendConfirmationNotification = async (userId, booking) => {
    try {
        const { phone, name, date, timeSlot, reason, tokenNumber, id } = booking;

        if (!phone) {
            console.error('No phone number for booking notification');
            return { success: false, error: 'No phone number' };
        }

        // Get WhatsApp session
        const session = whatsappService.getSession(userId);
        if (!session || session.status !== 'connected') {
            console.error('WhatsApp not connected for notification');
            return { success: false, error: 'WhatsApp not connected' };
        }

        const jid = `${phone}@s.whatsapp.net`;

        // Generate QR code
        const qrBuffer = await generateBookingQR({
            bookingId: id,
            tokenNumber,
            name,
            date,
            timeSlot,
            reason
        });

        // Send confirmation message with QR code image
        const confirmationMessage = `✅ *BOOKING CONFIRMED!*

━━━━━━━━━━━━━━━━━━━━━
🎫 *Token:* #${tokenNumber}
👤 *Name:* ${name || 'Customer'}
📅 *Date:* ${date}
⏰ *Time:* ${timeSlot}
📝 *Reason:* ${reason || 'General Consultation'}
━━━━━━━━━━━━━━━━━━━━━

Please show this QR code at check-in.
_Thank you for booking with us!_`;

        // Send message first
        await session.sock.sendMessage(jid, { text: confirmationMessage });

        // Send QR code image
        await session.sock.sendMessage(jid, {
            image: qrBuffer,
            caption: '📱 *Your Booking QR Code*\nShow this at check-in'
        });

        console.log(`✅ Confirmation notification sent to ${phone}`);
        return { success: true };

    } catch (error) {
        console.error('Error sending confirmation notification:', error);
        return { success: false, error: error.message };
    }
};

/**
 * Send rejection notification
 */
const sendRejectionNotification = async (userId, booking, staffNote) => {
    try {
        const { phone, name, date, timeSlot, tokenNumber } = booking;

        if (!phone) return { success: false, error: 'No phone number' };

        const session = whatsappService.getSession(userId);
        if (!session || session.status !== 'connected') {
            return { success: false, error: 'WhatsApp not connected' };
        }

        const jid = `${phone}@s.whatsapp.net`;

        const message = `❌ *BOOKING UPDATE*

Sorry ${name || 'there'}, your booking request could not be confirmed.

📅 Date: ${date}
⏰ Time: ${timeSlot}
🎫 Token: #${tokenNumber}

${staffNote ? `📝 *Note:* ${staffNote}` : ''}

Please try booking another slot or contact us for assistance.`;

        await session.sock.sendMessage(jid, { text: message });

        console.log(`✅ Rejection notification sent to ${phone}`);
        return { success: true };

    } catch (error) {
        console.error('Error sending rejection notification:', error);
        return { success: false, error: error.message };
    }
};

module.exports = {
    generateBookingQR,
    sendConfirmationNotification,
    sendRejectionNotification
};
