require('dotenv').config()
const express = require('express')
const path = require('path')
const apiRoutes = require('./src/routes/api')
const whatsappService = require('./src/services/whatsappService')
const aiService = require('./src/services/aiService')
const knowledgeService = require('./src/services/knowledgeService')

const app = express()
const PORT = process.env.PORT || 3000

// Serve static files from frontend directory
app.use(express.static(path.join(__dirname, 'frontend')))

// API Routes
app.use('/api', apiRoutes)

// Start Services
aiService.initialize()
knowledgeService.initialize()

// Auto-init disabled - frontend triggers connection when user opens dashboard
// const autoInitService = require('./src/services/autoInitService')
// autoInitService.autoInitializeUsers()

const server = app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`)
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
