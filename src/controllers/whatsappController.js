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

module.exports = {
    getQR,
    getStatus
}
