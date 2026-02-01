/**
 * Auto-Initialize WhatsApp Sessions
 * Restores WhatsApp connections for users with stored credentials on server start
 */

const { db } = require('../config/firebase');
const { collection, getDocs } = require('firebase/firestore');

/**
 * Get all user IDs that have WhatsApp credentials stored
 */
const getUsersWithCredentials = async () => {
    try {
        const usersRef = collection(db, 'users');
        const usersSnapshot = await getDocs(usersRef);

        const usersWithCreds = [];

        for (const userDoc of usersSnapshot.docs) {
            const userId = userDoc.id;
            // Check if user has whatsapp_creds subcollection with 'creds' document
            const credsRef = collection(db, 'users', userId, 'whatsapp_creds');
            const credsSnapshot = await getDocs(credsRef);

            if (!credsSnapshot.empty) {
                usersWithCreds.push(userId);
            }
        }

        return usersWithCreds;
    } catch (error) {
        console.error('[AutoInit] Error getting users with credentials:', error);
        return [];
    }
};

/**
 * Delay helper
 */
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Auto-initialize WhatsApp for all users with stored credentials
 * Called on server startup - runs in background, doesn't block server
 */
const autoInitializeUsers = async () => {
    console.log('[AutoInit] Starting WhatsApp auto-initialization...');

    // Run in background - don't await the main logic
    setImmediate(async () => {
        try {
            // Delay to let server fully start
            await delay(3000);

            const userIds = await getUsersWithCredentials();

            if (userIds.length === 0) {
                console.log('[AutoInit] No users with stored credentials found');
                return;
            }

            console.log(`[AutoInit] Found ${userIds.length} user(s) with credentials`);

            // Lazy load whatsappService to avoid circular dependencies
            const whatsappService = require('./whatsappService');

            // Initialize each user's WhatsApp session with delays
            for (const userId of userIds) {
                try {
                    console.log(`[AutoInit] Initializing WhatsApp for user: ${userId}`);

                    // Use Promise with timeout to prevent hanging
                    await Promise.race([
                        whatsappService.initialize(userId),
                        delay(10000) // 10 second timeout per user
                    ]);

                    console.log(`[AutoInit] Started init for user: ${userId}`);

                    // Delay between users to prevent overwhelming WhatsApp servers
                    await delay(2000);
                } catch (error) {
                    // Log but don't crash - user may have stale credentials
                    console.log(`[AutoInit] Skipped user ${userId}: ${error.message || 'Connection failed'}`);
                }
            }

            console.log('[AutoInit] Auto-initialization complete');
        } catch (error) {
            console.error('[AutoInit] Error during auto-initialization:', error.message);
        }
    });
};

module.exports = {
    autoInitializeUsers,
    getUsersWithCredentials
};
