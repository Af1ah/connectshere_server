const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

let authReady = false;

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

        console.warn(`⚠️ GOOGLE_APPLICATION_CREDENTIALS file not found: ${resolvedExplicitPath}. Ignoring this path.`);
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

if (!admin.apps.length) {
    try {
        const serviceAccountPath = resolveExistingCredentialPath();
        const serviceAccountFromEnv = getServiceAccountFromEnv();

        if (serviceAccountPath) {
            const serviceAccount = require(serviceAccountPath);
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });
            authReady = true;
        } else if (serviceAccountFromEnv) {
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccountFromEnv)
            });
            authReady = true;
        } else {
            admin.initializeApp({
                credential: admin.credential.applicationDefault(),
                projectId: process.env.FIREBASE_PROJECT_ID
            });
            authReady = true;
        }
    } catch (e) {
        console.warn("Firebase Admin initialization failed. Auth verification might fail.", e);
    }
} else {
    authReady = true;
}

const verifyToken = async (req, res, next) => {
    if (!authReady) {
        return res.status(503).json({ error: 'Auth service unavailable: Firebase Admin credentials missing' });
    }

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
