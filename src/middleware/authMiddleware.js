const admin = require('firebase-admin');

// Initialize Firebase Admin SDK if not already initialized
// Note: You need to set GOOGLE_APPLICATION_CREDENTIALS environment variable 
// or initialize with service account key for admin privileges.
// However, for verifyIdToken, we might need admin SDK.
// If we don't have service account, we can't use admin SDK easily.
// BUT, the user requirement said "keep user credentials on firebase".
// Usually verifyIdToken requires Admin SDK.
// Let's check if we can use a library or if we have the credentials.
// The user has `auth_info_baileys` folder, which is for WhatsApp.
// For Firebase Admin, we usually need a service account.
// If not available, we can't verify tokens securely on backend without it.
// Assuming the user has set it up or we can use a lightweight verification.
// Actually, `firebase-admin` is the standard way.

// Let's assume we need to initialize it.
// If process.env.GOOGLE_APPLICATION_CREDENTIALS is set, `initializeApp()` works.
if (!admin.apps.length) {
    try {
        admin.initializeApp({
            credential: admin.credential.applicationDefault(),
            projectId: process.env.FIREBASE_PROJECT_ID
        });
    } catch (e) {
        console.warn("Firebase Admin initialization failed. Auth verification might fail.", e);
    }
}

const verifyToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }

    const token = authHeader.split('Bearer ')[1];

    try {
        const decodedToken = await admin.auth().verifyIdToken(token);
        req.user = decodedToken;
        next();
    } catch (error) {
        console.error('Error verifying token:', error);
        return res.status(403).json({ error: 'Unauthorized: Invalid token' });
    }
};

module.exports = verifyToken;
