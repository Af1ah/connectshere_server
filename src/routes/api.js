
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
router.post('/test-buttons', whatsappController.sendTestButtons);
router.delete('/credentials', whatsappController.clearCredentials);
router.get('/dashboard/stats', dashboardController.getDashboardStats);

router.get('/settings/ai', settingsController.getSettings);
router.post('/settings/ai', settingsController.updateSettings);

const consultantController = require('../controllers/consultantController');

// File Upload Routes
router.post('/settings/upload', upload.single('file'), settingsController.uploadFile);
router.delete('/settings/files/:id', settingsController.deleteFile);

// Knowledge Base Routes (RAG)
router.get('/knowledge', settingsController.listKnowledge);
router.post('/knowledge', settingsController.addKnowledge);
router.delete('/knowledge/:source', settingsController.deleteKnowledge);

// Consultant Booking Routes
router.get('/consultant/settings', consultantController.getSettings);
router.post('/consultant/settings', consultantController.updateSettings);
router.get('/consultant/slots/:date', consultantController.getAvailableSlots);
router.get('/consultant/next-dates', consultantController.getNextDates);
router.post('/consultant/bookings', consultantController.createBooking);
router.get('/consultant/bookings', consultantController.getBookings);
router.put('/consultant/bookings/:id/status', consultantController.updateBookingStatus);

// User Profile & Onboarding Routes
const userController = require('../controllers/userController');
router.get('/user/profile', userController.getProfile);
router.post('/user/profile', userController.updateProfile);
router.get('/user/onboarding', userController.getOnboardingStatus);
router.post('/user/onboarding', userController.updateOnboardingStatus);

module.exports = router;


