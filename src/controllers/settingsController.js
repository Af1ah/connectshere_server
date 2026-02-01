const firebaseService = require('../services/firebaseService');
const knowledgeService = require('../services/knowledgeService');
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
            'gemini-2.0-flash-lite',
            'gemini-3-flash-preview'
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
                model: 'gemini-2.0-flash',
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

        // Allow empty context for RAG-only mode
        const success = await firebaseService.updateAISettings(userId, {
            context: context || '',
            model: model || 'gemini-2.0-flash'
        });

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

/**
 * Upload file and convert to RAG knowledge chunks
 */
const uploadFile = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const { originalname, mimetype, buffer } = req.file;
        const textContent = await fileParser.parseFile(buffer, mimetype, originalname);

        const userId = req.user.uid;

        // Convert file content to RAG knowledge chunks
        const result = await knowledgeService.addKnowledge(
            userId,
            textContent,
            originalname,
            'document'
        );

        if (result.success) {
            res.json({
                message: 'File processed and added to knowledge base',
                source: originalname,
                chunksAdded: result.chunksAdded
            });
        } else {
            res.status(500).json({ error: result.error || 'Failed to process file' });
        }
    } catch (error) {
        console.error('Error uploading file:', error);
        res.status(500).json({ error: error.message || 'Failed to process file' });
    }
};

/**
 * Add text directly to knowledge base
 */
const addKnowledge = async (req, res) => {
    try {
        const userId = req.user.uid;
        const { content, source, category } = req.body;

        if (!content) {
            return res.status(400).json({ error: 'Content is required' });
        }

        const result = await knowledgeService.addKnowledge(
            userId,
            content,
            source || 'manual',
            category || 'general'
        );

        if (result.success) {
            res.json({
                message: 'Knowledge added successfully',
                chunksAdded: result.chunksAdded
            });
        } else {
            res.status(500).json({ error: result.error || 'Failed to add knowledge' });
        }
    } catch (error) {
        console.error('Error adding knowledge:', error);
        res.status(500).json({ error: 'Failed to add knowledge' });
    }
};

/**
 * List all knowledge entries
 */
const listKnowledge = async (req, res) => {
    try {
        const userId = req.user.uid;
        const entries = await knowledgeService.listKnowledge(userId);
        res.json({ entries });
    } catch (error) {
        console.error('Error listing knowledge:', error);
        res.status(500).json({ error: 'Failed to list knowledge' });
    }
};

/**
 * Delete knowledge by source
 */
const deleteKnowledge = async (req, res) => {
    try {
        const { source } = req.params;
        const userId = req.user.uid;

        const success = await knowledgeService.deleteKnowledgeBySource(userId, decodeURIComponent(source));

        if (success) {
            res.json({ message: 'Knowledge deleted successfully' });
        } else {
            res.status(500).json({ error: 'Failed to delete knowledge' });
        }
    } catch (error) {
        console.error('Error deleting knowledge:', error);
        res.status(500).json({ error: 'Failed to delete knowledge' });
    }
};

// Legacy deleteFile for backward compatibility
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
    deleteFile,
    addKnowledge,
    listKnowledge,
    deleteKnowledge
};
