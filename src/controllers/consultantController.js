/**
 * Consultant Booking Controller
 * API endpoints for consultant settings and booking management
 */

const consultantService = require('../services/consultantService');

/**
 * GET /api/consultant/settings
 * Get consultant configuration
 */
const getSettings = async (req, res) => {
    try {
        const userId = req.user.uid;
        const settings = await consultantService.getSettings(userId);
        res.json(settings);
    } catch (error) {
        console.error('Error fetching consultant settings:', error);
        res.status(500).json({ error: 'Failed to fetch settings' });
    }
};

/**
 * POST /api/consultant/settings
 * Update consultant configuration
 */
const updateSettings = async (req, res) => {
    try {
        const userId = req.user.uid;
        const settings = req.body;

        const success = await consultantService.updateSettings(userId, settings);
        if (success) {
            res.json({ message: 'Consultant settings updated successfully' });
        } else {
            res.status(500).json({ error: 'Failed to update settings' });
        }
    } catch (error) {
        console.error('Error updating consultant settings:', error);
        res.status(500).json({ error: 'Failed to update settings' });
    }
};

/**
 * GET /api/consultant/slots/:date
 * Get available slots for a specific date
 */
const getAvailableSlots = async (req, res) => {
    try {
        const userId = req.user.uid;
        const { date } = req.params;

        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
        }

        const slots = await consultantService.getAvailableSlots(userId, date);
        res.json(slots);
    } catch (error) {
        console.error('Error fetching available slots:', error);
        res.status(500).json({ error: 'Failed to fetch slots' });
    }
};

/**
 * GET /api/consultant/next-dates
 * Get next available dates for booking
 */
const getNextDates = async (req, res) => {
    try {
        const userId = req.user.uid;
        const count = parseInt(req.query.count) || 5;

        const dates = await consultantService.getNextAvailableDates(userId, count);
        res.json({ dates });
    } catch (error) {
        console.error('Error fetching next dates:', error);
        res.status(500).json({ error: 'Failed to fetch dates' });
    }
};

/**
 * POST /api/consultant/bookings
 * Create a new booking
 */
const createBooking = async (req, res) => {
    try {
        const userId = req.user.uid;
        const { phone, name, reason, date, timeSlot } = req.body;

        if (!phone || !date || !timeSlot) {
            return res.status(400).json({
                error: 'Missing required fields: phone, date, timeSlot'
            });
        }

        const result = await consultantService.createBooking(userId, {
            phone, name, reason, date, timeSlot
        });

        if (result.success) {
            res.json(result);
        } else {
            res.status(409).json({ error: result.error });
        }
    } catch (error) {
        console.error('Error creating booking:', error);
        res.status(500).json({ error: 'Failed to create booking' });
    }
};

/**
 * GET /api/consultant/bookings
 * Get all bookings (staff view)
 * Query params: status, date
 */
const getBookings = async (req, res) => {
    try {
        const userId = req.user.uid;
        const { status, date } = req.query;

        const filters = {};
        if (status) filters.status = status;
        if (date) filters.date = date;

        const bookings = await consultantService.getBookings(userId, filters);
        res.json({ bookings });
    } catch (error) {
        console.error('Error fetching bookings:', error);
        res.status(500).json({ error: 'Failed to fetch bookings' });
    }
};

/**
 * PUT /api/consultant/bookings/:id/status
 * Update booking status (confirm/reject)
 */
const updateBookingStatus = async (req, res) => {
    try {
        const userId = req.user.uid;
        const { id } = req.params;
        const { status, staffNote } = req.body;

        if (!status || !['confirmed', 'rejected', 'completed'].includes(status)) {
            return res.status(400).json({
                error: 'Invalid status. Must be: confirmed, rejected, or completed'
            });
        }

        // Get booking details before updating
        const bookings = await consultantService.getBookings(userId, {});
        const booking = bookings.find(b => b.id === id);

        if (!booking) {
            return res.status(404).json({ error: 'Booking not found' });
        }

        const result = await consultantService.updateBookingStatus(userId, id, status, staffNote);

        if (result.success) {
            // Send WhatsApp notification
            const notificationService = require('../services/bookingNotificationService');

            if (status === 'confirmed') {
                const notifResult = await notificationService.sendConfirmationNotification(userId, {
                    ...booking,
                    id
                });
                console.log(`Notification sent: ${notifResult.success ? 'success' : notifResult.error}`);
            } else if (status === 'rejected') {
                const notifResult = await notificationService.sendRejectionNotification(userId, booking, staffNote);
                console.log(`Rejection notification: ${notifResult.success ? 'success' : notifResult.error}`);
            }

            res.json({ message: `Booking ${status} successfully` });
        } else {
            res.status(500).json({ error: result.error });
        }
    } catch (error) {
        console.error('Error updating booking status:', error);
        res.status(500).json({ error: 'Failed to update booking' });
    }
};

module.exports = {
    getSettings,
    updateSettings,
    getAvailableSlots,
    getNextDates,
    createBooking,
    getBookings,
    updateBookingStatus
};
