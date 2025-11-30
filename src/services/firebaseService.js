const { db } = require('../config/firebase');
const { collection, addDoc, query, where, orderBy, limit, getDocs, serverTimestamp, setDoc, doc, updateDoc, increment, getCountFromServer, getDoc } = require('firebase/firestore');

const saveMessage = async (userId, role, content) => {
    try {
        // Store messages under the user's document
        const messagesRef = collection(db, 'users', userId, 'messages');
        await addDoc(messagesRef, {
            role,
            content,
            timestamp: serverTimestamp()
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
            totalTokens: inputTokens + outputTokens,
            timestamp: serverTimestamp()
        };
        // Store usage under the user's document
        const usageRef = collection(db, 'users', userId, 'usage');
        await addDoc(usageRef, data);
    } catch (error) {
        console.error('Error logging token usage:', error);
    }
};

const getConversationHistory = async (userId, messageLimit = 10) => {
    try {
        const messagesRef = collection(db, 'users', userId, 'messages');
        const q = query(messagesRef, orderBy('timestamp', 'desc'), limit(messageLimit));

        const querySnapshot = await getDocs(q);
        const history = [];

        querySnapshot.forEach((doc) => {
            const data = doc.data();
            history.push({
                role: data.role,
                parts: [{ text: data.content }]
            });
        });

        return history.reverse(); // Return in chronological order
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
        usageSnapshot.forEach(doc => {
            totalTokens += (doc.data().totalTokens || 0);
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

        if (snapshot.exists()) {
            return snapshot.data();
        } else {
            return null;
        }
    } catch (error) {
        console.error('Error getting AI settings:', error);
        return null;
    }
};

const updateAISettings = async (userId, settings) => {
    try {
        const docRef = doc(db, 'users', userId, 'settings', 'ai_config');
        await setDoc(docRef, settings, { merge: true });
        return true;
    } catch (error) {
        console.error('Error updating AI settings:', error);
        return false;
    }
};

const addFileContent = async (userId, fileData) => {
    try {
        const docRef = doc(db, 'users', userId, 'settings', 'ai_config');
        // Use arrayUnion to add the file object to the 'files' array
        const { arrayUnion } = require('firebase/firestore');
        // Ensure document exists first or setDoc with merge will handle it
        await setDoc(docRef, {
            files: arrayUnion(fileData)
        }, { merge: true });
        return true;
    } catch (error) {
        console.error('Error adding file content:', error);
        return false;
    }
};

const removeFileContent = async (userId, fileId) => {
    try {
        const docRef = doc(db, 'users', userId, 'settings', 'ai_config');
        const snapshot = await getDoc(docRef);
        if (snapshot.exists()) {
            const data = snapshot.data();
            const files = data.files || [];
            const updatedFiles = files.filter(f => f.id !== fileId);

            await updateDoc(docRef, {
                files: updatedFiles
            });
            return true;
        }
        return false;
    } catch (error) {
        console.error('Error removing file content:', error);
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
    removeFileContent
};
