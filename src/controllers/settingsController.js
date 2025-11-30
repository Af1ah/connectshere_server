const firebaseService = require('../services/firebaseService');

const fileParser = require('../utils/fileParser');

const getSettings = async (req, res) => {
    try {
        const userId = req.user.uid;
        const settings = await firebaseService.getAISettings(userId);

        // Define the allowed models for all users
        const availableModels = [
            'gemini-2.5-flash',
            'gemini-2.5-flash-lite',
            'gemini-2.0-flash',
            'gemini-2.0-flash-lite'
        ];

        if (settings) {
            res.json({
                ...settings,
                availableModels
            });
        } else {
            // Return default settings if not found
            res.json({
                availableModels,
                model: 'gemini-2.0-flash', // default model
                context: ''
            });
        }
    } catch (error) {
        console.error('Error fetching settings:', error);
        res.status(500).json({ error: 'Failed to fetch settings' });
    }
};

const updateSettings = async (req, res) => {
    try {
        const userId = req.user.uid;
        const { context, model } = req.body;
        if (!context || !model) {
            return res.status(400).json({ error: 'Context and model are required' });
        }

        const success = await firebaseService.updateAISettings(userId, { context, model });
        if (success) {
            res.json({ message: 'Settings updated successfully' });
        } else {
            res.status(500).json({ error: 'Failed to update settings' });
        }
    } catch (error) {
        console.error('Error updating settings:', error);
        res.status(500).json({ error: 'Failed to update settings' });
    }
};

const uploadFile = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const { originalname, mimetype, buffer } = req.file;
        const textContent = await fileParser.parseFile(buffer, mimetype, originalname);

        const fileData = {
            id: Date.now().toString(),
            name: originalname,
            type: mimetype,
            content: textContent,
            timestamp: new Date().toISOString()
        };

        const userId = req.user.uid;
        const success = await firebaseService.addFileContent(userId, fileData);
        if (success) {
            res.json({ message: 'File uploaded and processed successfully', file: fileData });
        } else {
            res.status(500).json({ error: 'Failed to save file content' });
        }
    } catch (error) {
        console.error('Error uploading file:', error);
        res.status(500).json({ error: error.message || 'Failed to process file' });
    }
};

const deleteFile = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.uid;
        const success = await firebaseService.removeFileContent(userId, id);
        if (success) {
            res.json({ message: 'File deleted successfully' });
        } else {
            res.status(500).json({ error: 'Failed to delete file' });
        }
    } catch (error) {
        console.error('Error deleting file:', error);
        res.status(500).json({ error: 'Failed to delete file' });
    }
};

module.exports = {
    getSettings,
    updateSettings,
    uploadFile,
    deleteFile
};
