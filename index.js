require('dotenv').config()
const express = require('express')
const path = require('path')
const fs = require('fs')
const apiRoutes = require('./src/routes/api')
const whatsappService = require('./src/services/whatsappService')
const aiService = require('./src/services/aiService')
const knowledgeService = require('./src/services/knowledgeService')

const app = express()
const PORT = process.env.PORT || 3000

const sanitizeGoogleApplicationCredentials = () => {
    const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (!credentialPath) return;

    const resolvedPath = path.isAbsolute(credentialPath)
        ? credentialPath
        : path.resolve(process.cwd(), credentialPath);

    if (!fs.existsSync(resolvedPath)) {
        console.warn(`⚠️ GOOGLE_APPLICATION_CREDENTIALS points to missing file: ${resolvedPath}. Ignoring this env var.`);
        delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    }
};

sanitizeGoogleApplicationCredentials();

// Serve static files from frontend directory
app.use(express.static(path.join(__dirname, 'frontend')))

// Explicitly serve landing.html at root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend', 'landing.html'));
});

// Serve assets (fonts, images)
app.use('/assets', express.static(path.join(__dirname, 'assets')))

// API Routes
app.use('/api', apiRoutes)

// Start Services
aiService.initialize()
knowledgeService.initialize()

const autoInitService = require('./src/services/autoInitService')
autoInitService.autoInitializeUsers()

const HOST = process.env.HOST || '0.0.0.0'
const server = app.listen(PORT, HOST, () => {
    console.log(`Server is running on http://${HOST}:${PORT}`)
})

server.on('error', (e) => {
    console.error('Server Error:', e);
});

process.on('uncaughtException', (err) => {
    // Don't crash on WebSocket connection errors (common with stale WhatsApp creds)
    if (err.message?.includes('WebSocket') || err.message?.includes('Connection Failure')) {
        console.log('[WhatsApp] Connection error (ignored):', err.message);
        return;
    }
    console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    // Log but don't crash - many are from WhatsApp library
    console.log('Unhandled Rejection:', reason?.message || reason);
});

process.on('exit', (code) => {
    console.log(`About to exit with code: ${code}`);
});
