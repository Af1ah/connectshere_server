/**
 * Auto-Initialize WhatsApp Sessions
 * Restores WhatsApp connections for users with stored credentials on server start
 */

const { db } = require('../config/firebase');
const { collection, getDocs } = require('firebase/firestore');
const dns = require('dns').promises;

const INITIAL_DELAY_MS = Number(process.env.WHATSAPP_AUTO_INIT_DELAY_MS || 3000);
const USER_INIT_TIMEOUT_MS = Number(process.env.WHATSAPP_USER_INIT_TIMEOUT_MS || 10000);
const USER_INIT_GAP_MS = Number(process.env.WHATSAPP_USER_INIT_GAP_MS || 2000);
const MONITOR_INTERVAL_MS = Number(process.env.WHATSAPP_CONNECTIVITY_CHECK_MS || 15000);

let connectivityMonitorTimer = null;
let wasOnline = null;
let syncInProgress = false;

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

const isInternetReachable = async () => {
    try {
        await Promise.any([
            dns.resolve('web.whatsapp.com'),
            dns.resolve('google.com')
        ]);
        return true;
    } catch (_) {
        return false;
    }
};

const syncSessionsForStoredUsers = async (reason = 'manual') => {
    if (syncInProgress) return;
    syncInProgress = true;

    try {
        const userIds = await getUsersWithCredentials();

        if (userIds.length === 0) {
            if (reason === 'startup') {
                console.log('[AutoInit] No users with stored credentials found');
            }
            return;
        }

        console.log(`[AutoInit] Sync trigger (${reason}) for ${userIds.length} user(s)`);

        // Lazy load whatsappService to avoid circular dependencies
        const whatsappService = require('./whatsappService');

        for (const userId of userIds) {
            try {
                const status = whatsappService.getStatus(userId);
                if (['connected', 'connecting', 'scanning'].includes(status)) {
                    continue;
                }

                console.log(`[AutoInit] Initializing WhatsApp for user: ${userId} (status: ${status})`);

                await Promise.race([
                    whatsappService.initialize(userId),
                    delay(USER_INIT_TIMEOUT_MS)
                ]);

                await delay(USER_INIT_GAP_MS);
            } catch (error) {
                console.log(`[AutoInit] Skipped user ${userId}: ${error.message || 'Connection failed'}`);
            }
        }
    } catch (error) {
        console.error('[AutoInit] Error during session sync:', error.message);
    } finally {
        syncInProgress = false;
    }
};

const startConnectivityMonitor = () => {
    if (connectivityMonitorTimer) return;

    const runHealthCheck = async () => {
        const online = await isInternetReachable();

        if (wasOnline === null) {
            wasOnline = online;
            console.log(`[AutoInit] Internet status on monitor start: ${online ? 'online' : 'offline'}`);
            if (online) {
                await syncSessionsForStoredUsers('initial-online-check');
            }
            return;
        }

        if (!wasOnline && online) {
            console.log('[AutoInit] Internet restored. Triggering immediate WhatsApp reconnect.');
            await syncSessionsForStoredUsers('internet-restored');
        }

        wasOnline = online;
    };

    runHealthCheck().catch((error) => {
        console.error('[AutoInit] Initial connectivity check failed:', error.message);
    });

    connectivityMonitorTimer = setInterval(() => {
        runHealthCheck().catch((error) => {
            console.error('[AutoInit] Connectivity monitor error:', error.message);
        });
    }, MONITOR_INTERVAL_MS);
};

/**
 * Auto-initialize WhatsApp for all users with stored credentials
 * Called on server startup - runs in background, doesn't block server
 */
const autoInitializeUsers = async () => {
    console.log('[AutoInit] Starting WhatsApp auto-initialization...');

    startConnectivityMonitor();

    // Run in background - don't block server boot
    setImmediate(async () => {
        try {
            // Delay to let server fully start
            await delay(INITIAL_DELAY_MS);
            await syncSessionsForStoredUsers('startup');
            console.log('[AutoInit] Startup auto-initialization complete');
        } catch (error) {
            console.error('[AutoInit] Error during auto-initialization:', error.message);
        }
    });
};

module.exports = {
    autoInitializeUsers,
    getUsersWithCredentials
};
