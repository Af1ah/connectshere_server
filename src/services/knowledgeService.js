/**
 * Knowledge Service
 * Manages RAG knowledge base with Firestore vector storage
 */
const admin = require('firebase-admin');
const embeddingService = require('./embeddingService');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

let adminDb = null;
const BATCH_WRITE_LIMIT = 400;
let isCredentialFailureDisabled = false;

const resolveExistingCredentialPath = () => {
    const explicitCredPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    const defaultServiceAccountPath = path.join(process.cwd(), 'alex-agent-b2eb1-firebase-adminsdk-fbsvc-967a1bfb30.json');
    const localServiceAccountPath = path.join(__dirname, '..', '..', 'alex-agent-b2eb1-firebase-adminsdk-fbsvc-967a1bfb30.json');

    if (explicitCredPath) {
        const resolvedExplicitPath = path.isAbsolute(explicitCredPath)
            ? explicitCredPath
            : path.resolve(process.cwd(), explicitCredPath);

        if (fs.existsSync(resolvedExplicitPath)) {
            return resolvedExplicitPath;
        }

        console.warn(`⚠️ GOOGLE_APPLICATION_CREDENTIALS file not found: ${resolvedExplicitPath}. Falling back to other Firebase credentials.`);
        delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    }

    if (fs.existsSync(defaultServiceAccountPath)) {
        return defaultServiceAccountPath;
    }

    if (fs.existsSync(localServiceAccountPath)) {
        return localServiceAccountPath;
    }

    return null;
};

const getServiceAccountFromEnv = () => {
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL || process.env.FIREBASE_ADMIN_CLIENT_EMAIL || process.env.GOOGLE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY || process.env.FIREBASE_ADMIN_PRIVATE_KEY;
    const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;

    if (!clientEmail || !privateKey || !projectId) {
        return null;
    }

    return {
        projectId,
        clientEmail,
        privateKey: privateKey.replace(/\\n/g, '\n')
    };
};

const isCredentialError = (error) => {
    const message = String(error?.message || '');
    return (
        error?.code === 'ENOENT' ||
        message.includes('Could not load the default credentials') ||
        message.includes('GOOGLE_APPLICATION_CREDENTIALS') ||
        message.includes('The file at')
    );
};

const disableRagOnCredentialFailure = (error) => {
    adminDb = null;
    if (!isCredentialFailureDisabled) {
        isCredentialFailureDisabled = true;
        console.warn(`⚠️ Disabling RAG knowledge service due to credential error: ${error?.message || 'unknown error'}`);
    }
};

/**
 * Initialize Firebase Admin for server-side vector operations
 */
const initialize = () => {
    if (adminDb) return; // Already initialized

    try {
        if (!admin.apps.length) {
            const serviceAccountPath = resolveExistingCredentialPath();
            const serviceAccountFromEnv = getServiceAccountFromEnv();

            if (serviceAccountPath) {
                const serviceAccount = require(serviceAccountPath);
                admin.initializeApp({
                    credential: admin.credential.cert(serviceAccount)
                });
                console.log('✅ Firebase Admin initialized with service account file');
            } else if (serviceAccountFromEnv) {
                admin.initializeApp({
                    credential: admin.credential.cert(serviceAccountFromEnv)
                });
                console.log('✅ Firebase Admin initialized with env variables');
            } else {
                admin.initializeApp({
                    credential: admin.credential.applicationDefault(),
                    projectId: process.env.FIREBASE_PROJECT_ID
                });
                console.log('✅ Firebase Admin initialized with application default credentials');
            }
        }

        adminDb = admin.firestore();
        adminDb.settings({ ignoreUndefinedProperties: true });
        embeddingService.initialize();
    } catch (error) {
        console.error('❌ Failed to initialize Firebase Admin:', error.message);
    }
};

const getChunkDocId = (source, index, content) => {
    const hash = crypto.createHash('sha1').update(content).digest('hex').slice(0, 10);
    return `${encodeURIComponent(source)}__${index}__${hash}`;
};

const commitChunkedWrites = async (operations) => {
    if (!operations.length) return;

    for (let i = 0; i < operations.length; i += BATCH_WRITE_LIMIT) {
        const batch = adminDb.batch();
        const chunk = operations.slice(i, i + BATCH_WRITE_LIMIT);
        for (const op of chunk) {
            if (op.type === 'set') {
                batch.set(op.ref, op.data, op.options);
            } else if (op.type === 'delete') {
                batch.delete(op.ref);
            }
        }
        await batch.commit();
    }
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
        return { success: false, error: 'Knowledge service not initialized' };
    }

    try {
        // Process text into embedded chunks
        const chunks = await embeddingService.processText(content, source);

        const knowledgeRef = adminDb.collection('users').doc(userId).collection('knowledge');
        const sourceRef = adminDb.collection('users').doc(userId).collection('knowledge_sources').doc(encodeURIComponent(source));
        const writes = [];

        let upsertedChunks = 0;
        for (const chunk of chunks) {
            const docRef = knowledgeRef.doc(getChunkDocId(source, chunk.index, chunk.content));
            writes.push({
                type: 'set',
                ref: docRef,
                options: { merge: true },
                data: {
                content: chunk.content,
                source: chunk.source,
                category,
                index: chunk.index,
                embedding: admin.firestore.FieldValue.vector(chunk.embedding),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                createdAt: admin.firestore.FieldValue.serverTimestamp()
                }
            });
            upsertedChunks++;
        }

        writes.push({
            type: 'set',
            ref: sourceRef,
            options: { merge: true },
            data: {
                source,
                category,
                chunks: upsertedChunks,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            }
        });

        await commitChunkedWrites(writes);

        return { success: true, chunksAdded: upsertedChunks };
    } catch (error) {
        if (isCredentialError(error)) {
            disableRagOnCredentialFailure(error);
            return { success: false, error: 'Knowledge service credentials are not configured' };
        }
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
        return [];
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
        if (isCredentialError(error)) {
            disableRagOnCredentialFailure(error);
            return [];
        }
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
        return [];
    }

    try {
        const sourcesRef = adminDb.collection('users').doc(userId).collection('knowledge_sources');
        const snapshot = await sourcesRef.orderBy('updatedAt', 'desc').get();

        const entries = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            entries.push({
                source: data.source || decodeURIComponent(doc.id),
                category: data.category || 'general',
                chunks: data.chunks || 0,
                updatedAt: data.updatedAt || null
            });
        });
        return entries;
    } catch (error) {
        if (isCredentialError(error)) {
            disableRagOnCredentialFailure(error);
            return [];
        }
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
        return false;
    }

    try {
        const knowledgeRef = adminDb.collection('users').doc(userId).collection('knowledge');
        const snapshot = await knowledgeRef.where('source', '==', source).get();

        const writes = [];
        snapshot.forEach(doc => {
            writes.push({ type: 'delete', ref: doc.ref });
        });

        const sourceRef = adminDb.collection('users').doc(userId).collection('knowledge_sources').doc(encodeURIComponent(source));
        writes.push({ type: 'delete', ref: sourceRef });

        await commitChunkedWrites(writes);
        return true;
    } catch (error) {
        if (isCredentialError(error)) {
            disableRagOnCredentialFailure(error);
            return false;
        }
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
