/**
 * Knowledge Service
 * Manages RAG knowledge base with Firestore vector storage
 */
const admin = require('firebase-admin');
const embeddingService = require('./embeddingService');

let adminDb = null;

/**
 * Initialize Firebase Admin for server-side vector operations
 */
const initialize = () => {
    if (!admin.apps.length) {
        // Initialize with credentials from environment
        const serviceAccount = {
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
        };

        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    }

    adminDb = admin.firestore();
    embeddingService.initialize();
};

/**
 * Add knowledge entry to user's knowledge base
 * @param {string} userId - User ID
 * @param {string} content - Text content to add
 * @param {string} source - Source name (e.g., 'manual', 'file.pdf')
 * @param {string} category - Category tag (e.g., 'product', 'faq', 'policy')
 * @returns {Promise<{success: boolean, chunksAdded: number}>}
 */
const addKnowledge = async (userId, content, source = 'manual', category = 'general') => {
    if (!adminDb) {
        throw new Error('Knowledge service not initialized');
    }

    try {
        // Process text into embedded chunks
        const chunks = await embeddingService.processText(content, source);

        // Store each chunk in Firestore
        const batch = adminDb.batch();
        const knowledgeRef = adminDb.collection('users').doc(userId).collection('knowledge');

        for (const chunk of chunks) {
            const docRef = knowledgeRef.doc();
            batch.set(docRef, {
                content: chunk.content,
                source: chunk.source,
                category,
                index: chunk.index,
                embedding: admin.firestore.FieldValue.vector(chunk.embedding),
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
        }

        await batch.commit();

        return { success: true, chunksAdded: chunks.length };
    } catch (error) {
        console.error('Error adding knowledge:', error);
        return { success: false, error: error.message };
    }
};

/**
 * Search knowledge base for relevant context
 * @param {string} userId - User ID
 * @param {string} query - Search query
 * @param {number} limit - Max results to return
 * @returns {Promise<Array<{content: string, source: string, score: number}>>}
 */
const searchKnowledge = async (userId, query, limit = 5) => {
    if (!adminDb) {
        throw new Error('Knowledge service not initialized');
    }

    try {
        // Generate embedding for query
        const queryEmbedding = await embeddingService.generateEmbedding(query);

        // Query Firestore with vector search
        const knowledgeRef = adminDb.collection('users').doc(userId).collection('knowledge');

        // Use findNearest for vector similarity search
        const results = await knowledgeRef
            .findNearest('embedding', queryEmbedding, {
                limit,
                distanceMeasure: 'COSINE'
            })
            .get();

        const relevantChunks = [];
        results.forEach(doc => {
            const data = doc.data();
            relevantChunks.push({
                id: doc.id,
                content: data.content,
                source: data.source,
                category: data.category
            });
        });

        return relevantChunks;
    } catch (error) {
        console.error('Error searching knowledge:', error);
        return [];
    }
};

/**
 * Get all knowledge entries for a user
 * @param {string} userId - User ID
 * @returns {Promise<Array>}
 */
const listKnowledge = async (userId) => {
    if (!adminDb) {
        throw new Error('Knowledge service not initialized');
    }

    try {
        const knowledgeRef = adminDb.collection('users').doc(userId).collection('knowledge');
        const snapshot = await knowledgeRef.orderBy('createdAt', 'desc').get();

        const entries = [];
        const sources = new Map();

        snapshot.forEach(doc => {
            const data = doc.data();
            // Group by source
            if (!sources.has(data.source)) {
                sources.set(data.source, {
                    source: data.source,
                    category: data.category,
                    chunks: 0,
                    firstChunkId: doc.id
                });
            }
            sources.get(data.source).chunks++;
        });

        sources.forEach(value => entries.push(value));
        return entries;
    } catch (error) {
        console.error('Error listing knowledge:', error);
        return [];
    }
};

/**
 * Delete knowledge by source
 * @param {string} userId - User ID
 * @param {string} source - Source to delete
 * @returns {Promise<boolean>}
 */
const deleteKnowledgeBySource = async (userId, source) => {
    if (!adminDb) {
        throw new Error('Knowledge service not initialized');
    }

    try {
        const knowledgeRef = adminDb.collection('users').doc(userId).collection('knowledge');
        const snapshot = await knowledgeRef.where('source', '==', source).get();

        const batch = adminDb.batch();
        snapshot.forEach(doc => {
            batch.delete(doc.ref);
        });

        await batch.commit();
        return true;
    } catch (error) {
        console.error('Error deleting knowledge:', error);
        return false;
    }
};

/**
 * Build RAG context from user message
 * @param {string} userId - User ID
 * @param {string} message - User message
 * @returns {Promise<string>} - Retrieved context
 */
const buildContext = async (userId, message) => {
    const relevantChunks = await searchKnowledge(userId, message, 5);

    if (relevantChunks.length === 0) {
        return '';
    }

    let context = '--- RELEVANT KNOWLEDGE ---\n';
    relevantChunks.forEach((chunk, i) => {
        context += `\n[${i + 1}] (Source: ${chunk.source})\n${chunk.content}\n`;
    });

    return context;
};

module.exports = {
    initialize,
    addKnowledge,
    searchKnowledge,
    listKnowledge,
    deleteKnowledgeBySource,
    buildContext
};
