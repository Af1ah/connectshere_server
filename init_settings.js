require('dotenv').config();
const firebaseService = require('./src/services/firebaseService');
const contextData = require('./src/config/context');

const initialSettings = {
    context: contextData,
    model: 'gemini-2.0-flash',
    availableModels: [
        'gemini-2.5-flash',
        'gemini-2.5-flash-lite',
        'gemini-2.0-flash',
        'gemini-2.0-flash-lite',
        'gemini-3-flash-preview'
    ]
};

async function run() {
    try {
        console.log('Initializing AI Settings...');
        const success = await firebaseService.updateAISettings(initialSettings);
        if (success) {
            console.log('✅ AI Settings initialized successfully.');
        } else {
            console.error('❌ Failed to initialize AI Settings.');
        }
    } catch (error) {
        console.error('Error:', error);
    }
    process.exit();
}

run();
