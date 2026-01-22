const whatsappService = require('../services/whatsappService')

const getQR = async (req, res) => {
    const startTime = Date.now();
    const userId = req.user.uid;
    console.log(`[${new Date().toISOString()}] 🔄 /api/qr - Request from user: ${userId}`);

    // Ensure session is initialized
    await whatsappService.initialize(userId);

    const qr = whatsappService.getQR(userId);
    const elapsedTime = Date.now() - startTime;

    if (qr) {
        console.log(`[${new Date().toISOString()}] ✅ /api/qr - QR code generated (${qr.length} chars) in ${elapsedTime}ms`);
        console.log(`[${new Date().toISOString()}] 📱 QR Preview: ${qr.substring(0, 50)}...`);
    } else {
        console.log(`[${new Date().toISOString()}] ⚠️ /api/qr - No QR code available yet (${elapsedTime}ms)`);
    }

    res.json({ qr });
}


const getStatus = (req, res) => {
    const startTime = Date.now();
    const userId = req.user.uid;
    const status = whatsappService.getStatus(userId);
    const elapsedTime = Date.now() - startTime;

    console.log(`[${new Date().toISOString()}] 📊 /api/status - User: ${userId}, Status: ${status} (${elapsedTime}ms)`);

    res.json({ status });
}

const disconnect = async (req, res) => {
    const startTime = Date.now();
    const userId = req.user.uid;

    try {
        console.log(`[${new Date().toISOString()}] 🔌 /api/disconnect - User: ${userId} requesting disconnect`);
        await whatsappService.disconnect(userId);
        const elapsedTime = Date.now() - startTime;
        console.log(`[${new Date().toISOString()}] ✅ /api/disconnect - User: ${userId} disconnected (${elapsedTime}ms)`);
        res.json({ success: true, message: 'WhatsApp disconnected' });
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ /api/disconnect - Error:`, error);
        res.status(500).json({ success: false, error: error.message });
    }
}

const clearCredentials = async (req, res) => {
    const startTime = Date.now();
    const userId = req.user.uid;

    try {
        console.log(`[${new Date().toISOString()}] 🗑️ /api/credentials - User: ${userId} clearing credentials`);
        const result = await whatsappService.clearCredentials(userId);
        const elapsedTime = Date.now() - startTime;
        console.log(`[${new Date().toISOString()}] ✅ /api/credentials - User: ${userId} cleared ${result.deleted} docs (${elapsedTime}ms)`);
        res.json({ success: true, message: 'Credentials cleared', ...result });
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ /api/credentials - Error:`, error);
        res.status(500).json({ success: false, error: error.message });
    }
}

module.exports = {
    getQR,
    getStatus,
    disconnect,
    clearCredentials
}
