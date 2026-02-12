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
    writeBatch
} = require('firebase/firestore');

const normalizeConversationId = (conversationId = '') => {
    const clean = String(conversationId || '').trim();
    if (!clean) return 'default';
    return clean.replace(/[^a-zA-Z0-9_-]/g, '_');
};

const getConversationDocRef = (userId, conversationId = null) => {
    const safeConversationId = normalizeConversationId(conversationId);
    return doc(db, 'users', userId, 'conversations', safeConversationId);
};

const getMessagesCollection = (userId, conversationId = null) => {
    const safeConversationId = normalizeConversationId(conversationId);
    return collection(db, 'users', userId, 'conversations', safeConversationId, 'messages');
};

const saveMessage = async (userId, role, content, conversationId = null) => {
    try {
        const safeConversationId = normalizeConversationId(conversationId);
        const conversationRef = getConversationDocRef(userId, safeConversationId);
        await setDoc(conversationRef, {
            conversationId: safeConversationId,
            channel: safeConversationId.startsWith('wa_') ? 'whatsapp' : 'app',
            participantKey: safeConversationId,
            updatedAt: serverTimestamp()
        }, { merge: true });

        const messagesRef = getMessagesCollection(userId, conversationId);
        await addDoc(messagesRef, {
            role,
            content,
            conversationId: safeConversationId,
            createdAt: serverTimestamp(),
        });

        // Update user interaction count
        await updateUserStats(userId);

    } catch (error) {
        console.error('Error saving message to Firebase:', error);
    }
};

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
        const data = {
            inputTokens,
            outputTokens,
            createdAt: serverTimestamp()
        };
        // Store usage under the user's document
        const usageRef = collection(db, 'users', userId, 'usage');
        await addDoc(usageRef, data);
    } catch (error) {
        console.error('Error logging token usage:', error);
    }
};

const getConversationHistory = async (userId, messageLimit = 10, conversationId = null) => {
    try {
        const messagesRef = getMessagesCollection(userId, conversationId);
        const q = query(messagesRef, orderBy('createdAt', 'desc'), limit(messageLimit));

        const querySnapshot = await getDocs(q);
        const history = [];

        querySnapshot.forEach((doc) => {
            const data = doc.data();
            history.push({
                role: data.role,
                parts: [{ text: data.content }]
            });
        });

        if (history.length > 0) {
            return history.reverse(); // Return in chronological order
        }

        // Backward compatibility for legacy non-conversation messages collection
        const legacyRef = collection(db, 'users', userId, 'messages');
        const legacyQuery = query(legacyRef, orderBy('timestamp', 'desc'), limit(messageLimit));
        const legacySnapshot = await getDocs(legacyQuery);
        const legacyHistory = [];
        legacySnapshot.forEach((legacyDoc) => {
            const data = legacyDoc.data();
            legacyHistory.push({
                role: data.role,
                parts: [{ text: data.content }]
            });
        });

        return legacyHistory.reverse();
    } catch (error) {
        console.error('Error fetching conversation history:', error);
        return [];
    }
};

const getDashboardStats = async (userId) => {
    try {
        // Get user specific stats
        const userRef = doc(db, 'users', userId);
        const userSnap = await getDoc(userRef);

        let interactionCount = 0;
        if (userSnap.exists()) {
            interactionCount = userSnap.data().interactionCount || 0;
        }

        // Get total tokens for this user
        const usageRef = collection(db, 'users', userId, 'usage');
        const usageSnapshot = await getDocs(usageRef);
        let totalTokens = 0;
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

        // For "Recent Users", since this is a user dashboard, maybe show recent sessions or just self?
        // The requirement said "different dashboards for different users.(only user view their details only)."
        // So we only return this user's data.

        const recentUsers = [];
        if (userSnap.exists()) {
            recentUsers.push({ id: userId, ...userSnap.data() });
        }

        return {
            totalUsers: 1, // Only seeing self
            totalTokens,
            recentUsers
        };
    } catch (error) {
        console.error('Error getting dashboard stats:', error);
        return { totalUsers: 0, totalTokens: 0, recentUsers: [] };
    }
};

const getAISettings = async (userId) => {
    try {
        const docRef = doc(db, 'users', userId, 'settings', 'ai_config');
        const snapshot = await getDoc(docRef);
        if (!snapshot.exists()) {
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
            // Backward compatibility for legacy array-based file storage
            files = aiConfig.files;
        }

        return {
            ...aiConfig,
            files
        };
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

module.exports = {
    saveMessage,
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
    updateOnboardingStatus
};
