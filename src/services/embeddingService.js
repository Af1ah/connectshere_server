/**
 * Embedding Service
 * Generates text embeddings using Google Gemini API for RAG
 */
const { GoogleGenAI } = require('@google/genai');

let ai = null;
const EMBEDDING_MODELS = (process.env.GEMINI_EMBEDDING_MODELS || 'gemini-embedding-001,text-embedding-004')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
const CHUNK_SIZE = 800; // Characters per chunk
const CHUNK_OVERLAP = 100; // Overlap between chunks
const EMBEDDING_RETRIES = 3;
const RETRY_DELAY_MS = 500;

/**
 * Initialize the embedding service
 */
const initialize = () => {
    if (process.env.GEMINI_API_KEY) {
        ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    } else {
        console.warn('GEMINI_API_KEY not set. Embedding service disabled.');
    }
};

/**
 * Generate embedding for a single text
 * @param {string} text - Text to embed
 * @returns {Promise<number[]>} - Embedding vector
 */
const generateEmbedding = async (text) => {
    if (!ai) {
        throw new Error('Embedding service not initialized');
    }

    let lastError = null;

    for (const model of EMBEDDING_MODELS) {
        try {
            const result = await ai.models.embedContent({
                model,
                contents: text,
            });

            const values = result?.embeddings?.[0]?.values || result?.embedding?.values;
            if (!Array.isArray(values)) {
                throw new Error(`Embedding response from model "${model}" had no vector values`);
            }

            return values;
        } catch (error) {
            lastError = error;
            const isModelNotFound = error?.status === 404 || String(error?.message || '').includes('NOT_FOUND');

            if (isModelNotFound) {
                continue;
            }

            console.error('Error generating embedding:', error);
            throw error;
        }
    }

    console.error('Error generating embedding: no configured embedding model is available', {
        attemptedModels: EMBEDDING_MODELS
    });
    throw lastError || new Error('No valid embedding model available');
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const generateEmbeddingWithRetry = async (text, retries = EMBEDDING_RETRIES) => {
    let lastError = null;

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            return await generateEmbedding(text);
        } catch (error) {
            lastError = error;
            if (attempt < retries) {
                await sleep(RETRY_DELAY_MS * attempt);
            }
        }
    }

    throw lastError || new Error('Failed to generate embedding');
};

/**
 * Split text into chunks for embedding
 * @param {string} text - Full text to chunk
 * @param {string} source - Source identifier (filename, etc.)
 * @returns {Array<{content: string, source: string, index: number}>}
 */
const chunkText = (text, source = 'unknown') => {
    const chunks = [];
    const cleanText = text.replace(/\s+/g, ' ').trim();

    if (cleanText.length <= CHUNK_SIZE) {
        chunks.push({ content: cleanText, source, index: 0 });
        return chunks;
    }

    let start = 0;
    let index = 0;

    while (start < cleanText.length) {
        let end = start + CHUNK_SIZE;

        // Try to break at sentence boundary
        if (end < cleanText.length) {
            const lastPeriod = cleanText.lastIndexOf('.', end);
            const lastNewline = cleanText.lastIndexOf('\n', end);
            const breakPoint = Math.max(lastPeriod, lastNewline);

            if (breakPoint > start + CHUNK_SIZE / 2) {
                end = breakPoint + 1;
            }
        }

        const chunk = cleanText.slice(start, end).trim();
        if (chunk) {
            chunks.push({ content: chunk, source, index });
            index++;
        }

        start = end - CHUNK_OVERLAP;
    }

    return chunks;
};

/**
 * Process text and generate embeddings for all chunks
 * @param {string} text - Full text to process
 * @param {string} source - Source identifier
 * @returns {Promise<Array<{content: string, source: string, index: number, embedding: number[]}>>}
 */
const processText = async (text, source = 'user_input') => {
    const chunks = chunkText(text, source);
    const processedChunks = [];
    let failedChunks = 0;

    for (const chunk of chunks) {
        try {
            const embedding = await generateEmbeddingWithRetry(chunk.content);
            processedChunks.push({
                ...chunk,
                embedding,
                createdAt: new Date().toISOString()
            });
        } catch (error) {
            console.error(`Failed to embed chunk ${chunk.index}:`, error);
            failedChunks++;
        }
    }

    if (processedChunks.length === 0) {
        throw new Error('Failed to generate embeddings for all chunks');
    }

    if (failedChunks > 0) {
        console.warn(`Embedding partially failed: ${failedChunks} chunks skipped from source "${source}"`);
    }

    return processedChunks;
};

/**
 * Calculate cosine similarity between two vectors
 * @param {number[]} a - First vector
 * @param {number[]} b - Second vector
 * @returns {number} - Similarity score (0-1)
 */
const cosineSimilarity = (a, b) => {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
};

module.exports = {
    initialize,
    generateEmbedding,
    generateEmbeddingWithRetry,
    chunkText,
    processText,
    cosineSimilarity,
    CHUNK_SIZE
};
