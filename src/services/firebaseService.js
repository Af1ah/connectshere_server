const { db } = require('../config/firebase');
const {
    collection,
    addDoc,
    query,
    where,
    orderBy,
    limit,
    getDocs,
    serverTimestamp,
    setDoc,
    doc,
    updateDoc,
    increment,
    getDoc,
    deleteDoc,
    writeBatch,
    Timestamp
} = require('firebase/firestore');

// ==================== CACHING LAYER ====================
// In-memory cache to reduce Firestore reads
const cache = new Map();
const CACHE_TTL = {
    aiSettings: 120000,      // 2 minutes - settings change rarely
    userProfile: 120000,     // 2 minutes
    onboarding: 300000,      // 5 minutes
    dashboardStats: 60000,   // 1 minute - show reasonably fresh data
    conversationHistory: 30000, // 30 seconds - for active chats
};

const getCached = (key, ttl) => {
    const entry = cache.get(key);
    if (entry && Date.now() - entry.timestamp < ttl) {
        return entry.data;
    }
    return null;
};

const setCache = (key, data) => {
    cache.set(key, { data, timestamp: Date.now() });
};

const invalidateCache = (pattern) => {
    for (const key of cache.keys()) {
        if (key.includes(pattern)) {
            cache.delete(key);
        }
    }
};

// Clean up expired cache entries periodically
setInterval(() => {
    const now = Date.now();
    const maxTtl = Math.max(...Object.values(CACHE_TTL));
    for (const [key, entry] of cache) {
        if (now - entry.timestamp > maxTtl) {
            cache.delete(key);
        }
    }
}, 60000);

// ========================================================

const normalizeConversationId = (conversationId = '') => {
    const clean = String(conversationId || '').trim();
    if (!clean) return 'default';
    return clean.replace(/[^a-zA-Z0-9_-]/g, '_');
};

const getConversationDocRef = (userId, conversationId = null) => {
    const safeConversationId = normalizeConversationId(conversationId);
    return doc(db, 'users', userId, 'conversations', safeConversationId);
};

// Legacy - kept for backward compatibility during migration
const getMessagesCollection = (userId, conversationId = null) => {
    const safeConversationId = normalizeConversationId(conversationId);
    return collection(db, 'users', userId, 'conversations', safeConversationId, 'messages');
};

// ==================== NEW CONVERSATION MODEL ====================
// Store messages as array in single conversation document
// Benefits: 1 read instead of N reads per conversation
//           1 write instead of 2 writes per exchange
// Limits: Firestore doc size 1MB, ~500-1000 messages max
const MAX_MESSAGES_PER_CONVERSATION = 100; // Keep last 100 messages

/**
 * Save a message exchange (user + model) to conversation
 * @param {string} userId - User ID
 * @param {string} userMessage - User's message
 * @param {string} modelResponse - AI's response
 * @param {string} conversationId - Conversation ID (e.g., wa_1234567890)
 */
const saveConversationExchange = async (userId, userMessage, modelResponse, conversationId = null) => {
    try {
        const safeConversationId = normalizeConversationId(conversationId);
        const conversationRef = getConversationDocRef(userId, safeConversationId);
        
        // Get existing conversation
        const conversationSnap = await getDoc(conversationRef);
        let messages = [];
        
        if (conversationSnap.exists()) {
            messages = conversationSnap.data().messages || [];
        }
        
        // Add new exchange
        const timestamp = new Date().toISOString();
        messages.push(
            { role: 'user', content: userMessage, timestamp },
            { role: 'model', content: modelResponse, timestamp }
        );
        
        // Trim to keep only last N messages
        if (messages.length > MAX_MESSAGES_PER_CONVERSATION) {
            messages = messages.slice(-MAX_MESSAGES_PER_CONVERSATION);
        }
        
        // Save conversation with updated messages
        await setDoc(conversationRef, {
            conversationId: safeConversationId,
            channel: safeConversationId.startsWith('wa_') ? 'whatsapp' : 'app',
            participantKey: safeConversationId,
            messages,
            messageCount: messages.length,
            updatedAt: serverTimestamp()
        }, { merge: true });
        
        // Update user interaction count
        await updateUserStats(userId);
        
        // Invalidate conversation history cache
        invalidateCache(`history:${userId}:${safeConversationId}`);
        
    } catch (error) {
        console.error('Error saving conversation exchange:', error);
    }
};

/**
 * Legacy: Save individual message (for backward compatibility)
 */
const saveMessage = async (userId, role, content, conversationId = null) => {
    // This is kept for backward compatibility but new code should use saveConversationExchange
    try {
        const safeConversationId = normalizeConversationId(conversationId);
        const conversationRef = getConversationDocRef(userId, safeConversationId);
        
        // Get existing conversation
        const conversationSnap = await getDoc(conversationRef);
        let messages = [];
        
        if (conversationSnap.exists()) {
            messages = conversationSnap.data().messages || [];
        }
        
        // Add new message
        messages.push({
            role,
            content,
            timestamp: new Date().toISOString()
        });
        
        // Trim to keep only last N messages
        if (messages.length > MAX_MESSAGES_PER_CONVERSATION) {
            messages = messages.slice(-MAX_MESSAGES_PER_CONVERSATION);
        }
        
        // Save conversation
        await setDoc(conversationRef, {
            conversationId: safeConversationId,
            channel: safeConversationId.startsWith('wa_') ? 'whatsapp' : 'app',
            participantKey: safeConversationId,
            messages,
            messageCount: messages.length,
            updatedAt: serverTimestamp()
        }, { merge: true });
        
        // Invalidate cache
        invalidateCache(`history:${userId}:${safeConversationId}`);
        
    } catch (error) {
        console.error('Error saving message:', error);
    }
};
// ================================================================

const updateUserStats = async (userId) => {
    try {
        const userRef = doc(db, 'users', userId);
        await setDoc(userRef, {
            lastActive: serverTimestamp(),
            interactionCount: increment(1)
        }, { merge: true });
    } catch (error) {
        console.error('Error updating user stats:', error);
    }
};

const logTokenUsage = async (userId, inputTokens, outputTokens) => {
    try {
        const totalTokens = (inputTokens || 0) + (outputTokens || 0);
        
        // Update aggregated total on user doc (avoids reading usage collection later)
        const userRef = doc(db, 'users', userId);
        await setDoc(userRef, {
            totalTokensUsed: increment(totalTokens),
            lastTokenUpdate: serverTimestamp()
        }, { merge: true });
        
        // Invalidate dashboard cache
        invalidateCache(`dashboard:${userId}`);
        
        // Still log individual usage for detailed analytics (optional)
        const usageRef = collection(db, 'users', userId, 'usage');
        await addDoc(usageRef, {
            inputTokens,
            outputTokens,
            totalTokens,
            createdAt: serverTimestamp()
        });
    } catch (error) {
        console.error('Error logging token usage:', error);
    }
};

// Track if user has legacy messages (check once per session)
const legacyMigrationChecked = new Set();

const getConversationHistory = async (userId, messageLimit = 10, conversationId = null) => {
    // Cache key for this specific conversation
    const cacheKey = `history:${userId}:${conversationId || 'default'}:${messageLimit}`;
    const cached = getCached(cacheKey, CACHE_TTL.conversationHistory);
    if (cached) return cached;

    try {
        const safeConversationId = normalizeConversationId(conversationId);
        const conversationRef = getConversationDocRef(userId, safeConversationId);
        
        // NEW: Read from single conversation document (1 read instead of N)
        const conversationSnap = await getDoc(conversationRef);
        
        if (conversationSnap.exists()) {
            const data = conversationSnap.data();
            const messages = data.messages || [];
            
            // Get last N messages and format for AI
            const recentMessages = messages.slice(-messageLimit);
            const history = recentMessages.map(msg => ({
                role: msg.role,
                parts: [{ text: msg.content }]
            }));
            
            if (history.length > 0) {
                setCache(cacheKey, history);
                return history;
            }
        }
        
        // LEGACY FALLBACK: Check old subcollection format
        const messagesRef = getMessagesCollection(userId, conversationId);
        const q = query(messagesRef, orderBy('createdAt', 'desc'), limit(messageLimit));
        const querySnapshot = await getDocs(q);
        
        if (!querySnapshot.empty) {
            const history = [];
            querySnapshot.forEach((docSnap) => {
                const data = docSnap.data();
                history.push({
                    role: data.role,
                    parts: [{ text: data.content }]
                });
            });
            const result = history.reverse();
            setCache(cacheKey, result);
            return result;
        }

        // LEGACY: Check even older messages collection
        const legacyKey = `legacy:${userId}`;
        if (legacyMigrationChecked.has(legacyKey)) {
            return [];
        }

        const legacyRef = collection(db, 'users', userId, 'messages');
        const legacyQuery = query(legacyRef, orderBy('timestamp', 'desc'), limit(messageLimit));
        const legacySnapshot = await getDocs(legacyQuery);
        
        legacyMigrationChecked.add(legacyKey);
        
        const legacyHistory = [];
        legacySnapshot.forEach((legacyDoc) => {
            const data = legacyDoc.data();
            legacyHistory.push({
                role: data.role,
                parts: [{ text: data.content }]
            });
        });

        const result = legacyHistory.reverse();
        if (result.length > 0) {
            setCache(cacheKey, result);
        }
        return result;
    } catch (error) {
        console.error('Error fetching conversation history:', error);
        return [];
    }
};

const getDashboardStats = async (userId) => {
    // Check cache first - avoids reading entire usage collection
    const cacheKey = `dashboard:${userId}`;
    const cached = getCached(cacheKey, CACHE_TTL.dashboardStats);
    if (cached) return cached;

    try {
        // Get user specific stats (includes pre-aggregated token count)
        const userRef = doc(db, 'users', userId);
        const userSnap = await getDoc(userRef);

        let interactionCount = 0;
        let totalTokens = 0;
        
        if (userSnap.exists()) {
            const userData = userSnap.data();
            interactionCount = userData.interactionCount || 0;
            // Use pre-aggregated total if available (see logTokenUsage)
            totalTokens = userData.totalTokensUsed || 0;
        }

        // OPTIMIZATION: Only read usage collection if no aggregated total exists
        // This is a one-time migration path - new logTokenUsage updates user doc directly
        if (totalTokens === 0 && userSnap.exists()) {
            // Check if we need to migrate (only once)
            const usageRef = collection(db, 'users', userId, 'usage');
            const limitedQuery = query(usageRef, limit(50)); // Cap reads
            const usageSnapshot = await getDocs(limitedQuery);
            
            usageSnapshot.forEach((usageDoc) => {
                const data = usageDoc.data();
                if (typeof data.totalTokens === 'number') {
                    totalTokens += data.totalTokens;
                    return;
                }
                const inputTokens = Number(data.inputTokens || 0);
                const outputTokens = Number(data.outputTokens || 0);
                totalTokens += inputTokens + outputTokens;
            });
            
            // Persist aggregated total to avoid future reads
            if (totalTokens > 0) {
                await updateDoc(userRef, { totalTokensUsed: totalTokens });
            }
        }

        const recentUsers = [];
        if (userSnap.exists()) {
            recentUsers.push({ id: userId, ...userSnap.data() });
        }

        const result = {
            totalUsers: 1,
            totalTokens,
            recentUsers
        };
        
        setCache(cacheKey, result);
        return result;
    } catch (error) {
        console.error('Error getting dashboard stats:', error);
        return { totalUsers: 0, totalTokens: 0, recentUsers: [] };
    }
};

const getAISettings = async (userId) => {
    // Check cache first
    const cacheKey = `aiSettings:${userId}`;
    const cached = getCached(cacheKey, CACHE_TTL.aiSettings);
    if (cached !== null) return cached;

    try {
        const docRef = doc(db, 'users', userId, 'settings', 'ai_config');
        const snapshot = await getDoc(docRef);
        if (!snapshot.exists()) {
            setCache(cacheKey, null);
            return null;
        }

        const aiConfig = snapshot.data();
        const filesRef = collection(db, 'users', userId, 'ai_config_files');
        const filesSnapshot = await getDocs(filesRef);
        let files = filesSnapshot.docs.map((fileDoc) => ({
            id: fileDoc.id,
            ...fileDoc.data()
        }));

        if (files.length === 0 && Array.isArray(aiConfig.files)) {
            files = aiConfig.files;
        }

        const result = {
            ...aiConfig,
            files
        };
        setCache(cacheKey, result);
        return result;
    } catch (error) {
        console.error('Error getting AI settings:', error);
        return null;
    }
};

const updateAISettings = async (userId, settings) => {
    try {
        const docRef = doc(db, 'users', userId, 'settings', 'ai_config');
        const nextSettings = {};
        if (typeof settings.context === 'string') nextSettings.context = settings.context;
        if (typeof settings.model === 'string') nextSettings.model = settings.model;
        nextSettings.updatedAt = serverTimestamp();
        await setDoc(docRef, nextSettings, { merge: true });
        
        // Invalidate cache
        invalidateCache(`aiSettings:${userId}`);
        return true;
    } catch (error) {
        console.error('Error updating AI settings:', error);
        return false;
    }
};

const addFileContent = async (userId, fileData) => {
    try {
        const filesRef = collection(db, 'users', userId, 'ai_config_files');
        if (fileData?.id) {
            const fileRef = doc(filesRef, String(fileData.id));
            await setDoc(fileRef, {
                ...fileData,
                updatedAt: serverTimestamp()
            }, { merge: true });
        } else {
            await addDoc(filesRef, {
                ...fileData,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            });
        }
        return true;
    } catch (error) {
        console.error('Error adding file content:', error);
        return false;
    }
};

const removeFileContent = async (userId, fileId) => {
    try {
        const fileRef = doc(db, 'users', userId, 'ai_config_files', fileId);
        await deleteDoc(fileRef);

        // Backward compatibility for legacy array-based file storage
        const aiConfigRef = doc(db, 'users', userId, 'settings', 'ai_config');
        const snapshot = await getDoc(aiConfigRef);
        if (snapshot.exists()) {
            const data = snapshot.data();
            if (Array.isArray(data.files)) {
                const updatedFiles = data.files.filter((f) => f?.id !== fileId);
                if (updatedFiles.length !== data.files.length) {
                    await updateDoc(aiConfigRef, { files: updatedFiles });
                }
            }
        }

        return true;
    } catch (error) {
        console.error('Error removing file content:', error);
        return false;
    }
};

const queueMessage = async (userId, messageData) => {
    try {
        const queueRef = collection(db, 'users', userId, 'messageQueue');
        await addDoc(queueRef, {
            ...messageData,
            queuedAt: serverTimestamp(),
            processed: false
        });
        return true;
    } catch (error) {
        console.error('Error queuing message:', error);
        return false;
    }
};

const getQueuedMessages = async (userId) => {
    try {
        const queueRef = collection(db, 'users', userId, 'messageQueue');
        // Simplified query to avoid composite index requirement
        const q = query(queueRef, where('processed', '==', false));

        const querySnapshot = await getDocs(q);
        const messages = [];

        querySnapshot.forEach((doc) => {
            messages.push({
                id: doc.id,
                ...doc.data()
            });
        });

        // Sort manually by queuedAt in ascending order
        messages.sort((a, b) => {
            const timeA = a.queuedAt?.toMillis?.() || 0;
            const timeB = b.queuedAt?.toMillis?.() || 0;
            return timeA - timeB;
        });

        return messages;
    } catch (error) {
        console.error('Error getting queued messages:', error);
        return [];
    }
};

const clearQueuedMessage = async (userId, messageId) => {
    try {
        const messageRef = doc(db, 'users', userId, 'messageQueue', messageId);
        await updateDoc(messageRef, {
            processed: true,
            processedAt: serverTimestamp()
        });
        return true;
    } catch (error) {
        console.error('Error clearing queued message:', error);
        return false;
    }
};

/**
 * Get user profile (business details)
 */
const getUserProfile = async (userId) => {
    try {
        const docRef = doc(db, 'users', userId, 'settings', 'profile');
        const snapshot = await getDoc(docRef);
        return snapshot.exists() ? snapshot.data() : null;
    } catch (error) {
        console.error('Error getting user profile:', error);
        return null;
    }
};

/**
 * Update user profile
 */
const updateUserProfile = async (userId, profileData) => {
    try {
        const docRef = doc(db, 'users', userId, 'settings', 'profile');
        await setDoc(docRef, {
            ...profileData,
            updatedAt: serverTimestamp()
        }, { merge: true });
        return true;
    } catch (error) {
        console.error('Error updating user profile:', error);
        return false;
    }
};

/**
 * Get onboarding status
 */
const getOnboardingStatus = async (userId) => {
    try {
        const docRef = doc(db, 'users', userId, 'settings', 'onboarding');
        const [snapshot, stepsSnapshot] = await Promise.all([
            getDoc(docRef),
            getDocs(collection(db, 'users', userId, 'onboarding_steps'))
        ]);

        if (!snapshot.exists()) return null;

        const onboarding = snapshot.data();
        const completedSteps = stepsSnapshot.docs
            .map((stepDoc) => stepDoc.data())
            .filter((step) => step.status === 'completed')
            .map((step) => step.stepNo)
            .filter((stepNo) => Number.isFinite(stepNo))
            .sort((a, b) => a - b);

        if (completedSteps.length === 0 && Array.isArray(onboarding.completedSteps)) {
            // Legacy fallback
            return onboarding;
        }

        return {
            ...onboarding,
            completedSteps
        };
    } catch (error) {
        console.error('Error getting onboarding status:', error);
        return null;
    }
};

/**
 * Update onboarding status
 */
const updateOnboardingStatus = async (userId, statusData) => {
    try {
        const docRef = doc(db, 'users', userId, 'settings', 'onboarding');
        await setDoc(docRef, {
            currentStep: Number(statusData.currentStep || 0),
            completed: Boolean(statusData.completed),
            updatedAt: serverTimestamp()
        }, { merge: true });

        if (Array.isArray(statusData.completedSteps)) {
            const stepsRef = collection(db, 'users', userId, 'onboarding_steps');
            const existingSnapshot = await getDocs(stepsRef);
            const batch = writeBatch(db);

            existingSnapshot.forEach((stepDoc) => batch.delete(stepDoc.ref));
            for (const stepNo of statusData.completedSteps) {
                const normalizedStep = Number(stepNo);
                if (!Number.isFinite(normalizedStep)) continue;
                const stepRef = doc(db, 'users', userId, 'onboarding_steps', `step_${normalizedStep}`);
                batch.set(stepRef, {
                    stepNo: normalizedStep,
                    status: 'completed',
                    updatedAt: serverTimestamp()
                });
            }
            await batch.commit();
        }
        return true;
    } catch (error) {
        console.error('Error updating onboarding status:', error);
        return false;
    }
};

/**
 * Clear all user data (conversations and messages)
 * @param {string} userId - User ID
 * @returns {Promise<{success: boolean, cleared: object}>}
 */
const clearAllConversations = async (userId) => {
    try {
        const conversationsRef = collection(db, 'users', userId, 'conversations');
        const conversationsSnapshot = await getDocs(conversationsRef);
        
        let messagesDeleted = 0;
        let conversationsDeleted = 0;
        
        for (const convDoc of conversationsSnapshot.docs) {
            // Delete all messages in this conversation
            const messagesRef = collection(db, 'users', userId, 'conversations', convDoc.id, 'messages');
            const messagesSnapshot = await getDocs(messagesRef);
            
            const batch = writeBatch(db);
            let batchCount = 0;
            
            for (const msgDoc of messagesSnapshot.docs) {
                batch.delete(msgDoc.ref);
                batchCount++;
                messagesDeleted++;
                
                // Firestore batch limit is 500
                if (batchCount >= 450) {
                    await batch.commit();
                    batchCount = 0;
                }
            }
            
            if (batchCount > 0) {
                await batch.commit();
            }
            
            // Delete the conversation document
            await deleteDoc(convDoc.ref);
            conversationsDeleted++;
        }
        
        // Also clear legacy messages collection if exists
        const legacyRef = collection(db, 'users', userId, 'messages');
        const legacySnapshot = await getDocs(legacyRef);
        
        const legacyBatch = writeBatch(db);
        let legacyCount = 0;
        
        for (const msgDoc of legacySnapshot.docs) {
            legacyBatch.delete(msgDoc.ref);
            legacyCount++;
            messagesDeleted++;
        }
        
        if (legacyCount > 0) {
            await legacyBatch.commit();
        }
        
        console.log(`User ${userId}: Cleared ${conversationsDeleted} conversations, ${messagesDeleted} messages`);
        
        return {
            success: true,
            cleared: {
                conversations: conversationsDeleted,
                messages: messagesDeleted
            }
        };
    } catch (error) {
        console.error('Error clearing user conversations:', error);
        return { success: false, error: error.message };
    }
};

// ==================== AUTO CLEANUP OLD MESSAGES ====================
const MESSAGE_RETENTION_DAYS = 2;

/**
 * Delete old messages for a specific user
 * - NEW model: Trim messages array in conversation docs based on retention
 * - LEGACY: Delete old subcollection messages
 * @param {string} userId - User ID
 * @returns {Promise<{success: boolean, deleted: number}>}
 */
const cleanupOldMessages = async (userId) => {
    try {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - MESSAGE_RETENTION_DAYS);
        const cutoffTimestamp = Timestamp.fromDate(cutoffDate);
        const cutoffISO = cutoffDate.toISOString();
        
        let totalDeleted = 0;
        
        // Get all conversations for this user
        const conversationsRef = collection(db, 'users', userId, 'conversations');
        const conversationsSnapshot = await getDocs(conversationsRef);
        
        for (const convDoc of conversationsSnapshot.docs) {
            const convData = convDoc.data();
            
            // NEW MODEL: If conversation has messages array, trim old messages
            if (Array.isArray(convData.messages) && convData.messages.length > 0) {
                const originalCount = convData.messages.length;
                const filteredMessages = convData.messages.filter(msg => {
                    // Keep messages newer than cutoff
                    if (!msg.timestamp) return true; // Keep if no timestamp
                    return msg.timestamp >= cutoffISO;
                });
                
                const deletedCount = originalCount - filteredMessages.length;
                
                if (deletedCount > 0) {
                    // Update conversation with filtered messages
                    await updateDoc(convDoc.ref, {
                        messages: filteredMessages,
                        messageCount: filteredMessages.length,
                        updatedAt: serverTimestamp()
                    });
                    totalDeleted += deletedCount;
                }
            }
            
            // LEGACY: Also check old subcollection format
            const messagesRef = collection(db, 'users', userId, 'conversations', convDoc.id, 'messages');
            const oldMessagesQuery = query(
                messagesRef,
                where('createdAt', '<', cutoffTimestamp)
            );
            
            const oldMessagesSnapshot = await getDocs(oldMessagesQuery);
            
            if (!oldMessagesSnapshot.empty) {
                const batch = writeBatch(db);
                let batchCount = 0;
                
                for (const msgDoc of oldMessagesSnapshot.docs) {
                    batch.delete(msgDoc.ref);
                    batchCount++;
                    totalDeleted++;
                    
                    if (batchCount >= 450) {
                        await batch.commit();
                        batchCount = 0;
                    }
                }
                
                if (batchCount > 0) {
                    await batch.commit();
                }
            }
        }
        
        // LEGACY: Also cleanup old messages collection
        const legacyRef = collection(db, 'users', userId, 'messages');
        const legacyQuery = query(
            legacyRef,
            where('timestamp', '<', cutoffTimestamp)
        );
        const legacySnapshot = await getDocs(legacyQuery);
        
        if (!legacySnapshot.empty) {
            const legacyBatch = writeBatch(db);
            let legacyCount = 0;
            
            for (const msgDoc of legacySnapshot.docs) {
                legacyBatch.delete(msgDoc.ref);
                legacyCount++;
                totalDeleted++;
                
                if (legacyCount >= 450) {
                    await legacyBatch.commit();
                    legacyCount = 0;
                }
            }
            
            if (legacyCount > 0) {
                await legacyBatch.commit();
            }
        }
        
        // NOTE: Usage records are kept indefinitely for analytics
        
        if (totalDeleted > 0) {
            console.log(`[Cleanup] User ${userId}: Deleted ${totalDeleted} messages older than ${MESSAGE_RETENTION_DAYS} days`);
        }
        
        return { success: true, deleted: totalDeleted };
    } catch (error) {
        console.error(`Error cleaning up old messages for user ${userId}:`, error);
        return { success: false, error: error.message };
    }
};

/**
 * Cleanup old messages for all users
 * Called periodically to maintain storage efficiency
 */
const cleanupAllOldMessages = async () => {
    try {
        console.log('[Cleanup] Starting scheduled cleanup of old messages...');
        
        // Get all users
        const usersRef = collection(db, 'users');
        const usersSnapshot = await getDocs(usersRef);
        
        let totalUsersProcessed = 0;
        let totalMessagesDeleted = 0;
        
        for (const userDoc of usersSnapshot.docs) {
            const result = await cleanupOldMessages(userDoc.id);
            if (result.success) {
                totalUsersProcessed++;
                totalMessagesDeleted += result.deleted || 0;
            }
        }
        
        console.log(`[Cleanup] Completed: ${totalUsersProcessed} users processed, ${totalMessagesDeleted} messages deleted`);
        
        return {
            success: true,
            usersProcessed: totalUsersProcessed,
            messagesDeleted: totalMessagesDeleted
        };
    } catch (error) {
        console.error('Error in scheduled cleanup:', error);
        return { success: false, error: error.message };
    }
};

// Run cleanup every 6 hours (4 times per day)
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
let cleanupTimer = null;

const startAutoCleanup = () => {
    if (cleanupTimer) return; // Already running
    
    // Run initial cleanup after 5 minutes (let server stabilize)
    setTimeout(() => {
        cleanupAllOldMessages();
    }, 5 * 60 * 1000);
    
    // Then run every 6 hours
    cleanupTimer = setInterval(() => {
        cleanupAllOldMessages();
    }, CLEANUP_INTERVAL_MS);
    
    console.log('[Cleanup] Auto-cleanup scheduled: messages older than 2 days will be deleted every 6 hours');
};

// Start auto-cleanup when module loads
startAutoCleanup();

// ===================================================================

module.exports = {
    saveMessage,
    saveConversationExchange,
    getConversationHistory,
    updateUserStats,
    logTokenUsage,
    getDashboardStats,
    getAISettings,
    updateAISettings,
    addFileContent,
    removeFileContent,
    queueMessage,
    getQueuedMessages,
    clearQueuedMessage,
    getUserProfile,
    updateUserProfile,
    getOnboardingStatus,
    updateOnboardingStatus,
    clearAllConversations,
    cleanupOldMessages,
    cleanupAllOldMessages
};
