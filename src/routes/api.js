
const express = require('express');
const router = express.Router();
const multer = require('multer');
const whatsappController = require('../controllers/whatsappController');
const dashboardController = require('../controllers/dashboardController');
const settingsController = require('../controllers/settingsController');
const verifyToken = require('../middleware/authMiddleware');

// Configure Multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Middleware to parse JSON body for POST requests
router.use(express.json());

// Public Config Route
router.get('/config/firebase', (req, res) => {
    const { firebaseConfig } = require('../config/firebase');
    res.json(firebaseConfig);
});

// Protected Routes
router.use(verifyToken);

router.get('/qr', whatsappController.getQR);
router.get('/status', whatsappController.getStatus);
router.post('/disconnect', whatsappController.disconnect);
router.delete('/credentials', whatsappController.clearCredentials);
router.get('/dashboard/stats', dashboardController.getDashboardStats);

router.get('/settings/ai', settingsController.getSettings);
router.post('/settings/ai', settingsController.updateSettings);

// File Upload Routes
router.post('/settings/upload', upload.single('file'), settingsController.uploadFile);
router.delete('/settings/files/:id', settingsController.deleteFile);

// Config Routes (Moved up to be public)
// router.get('/config/firebase', ... ); 

module.exports = router;

