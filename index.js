require('dotenv').config()
const express = require('express')
const path = require('path')
const apiRoutes = require('./src/routes/api')
const whatsappService = require('./src/services/whatsappService')
const aiService = require('./src/services/aiService')

const app = express()
const PORT = process.env.PORT || 3000

// Serve static files from frontend directory
app.use(express.static(path.join(__dirname, 'frontend')))

// API Routes
app.use('/api', apiRoutes)

// Start Services
aiService.initialize()
// Start Services
aiService.initialize()
// whatsappService.initialize() // Removed global init, now per-user

const server = app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`)
})

server.on('error', (e) => {
    console.error('Server Error:', e);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('exit', (code) => {
    console.log(`About to exit with code: ${code}`);
});
