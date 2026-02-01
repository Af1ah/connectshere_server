/**
 * Booking State Manager
 * Tracks multi-step booking conversations per user/phone
 */

// In-memory state storage for booking flows
const bookingStates = new Map();

/**
 * Booking flow steps
 */
const BOOKING_STEPS = {
    IDLE: 'idle',
    AWAITING_REASON: 'awaiting_reason',
    AWAITING_DATE: 'awaiting_date',
    AWAITING_SLOT: 'awaiting_slot',
    AWAITING_NAME: 'awaiting_name',
    AWAITING_CONFIRM: 'awaiting_confirm'
};

/**
 * Get booking state for a phone number
 */
const getState = (phone) => {
    return bookingStates.get(phone) || { step: BOOKING_STEPS.IDLE };
};

/**
 * Set booking state for a phone number
 */
const setState = (phone, state) => {
    bookingStates.set(phone, {
        ...getState(phone),
        ...state,
        updatedAt: Date.now()
    });
};

/**
 * Clear booking state for a phone number
 */
const clearState = (phone) => {
    bookingStates.delete(phone);
};

/**
 * Start a new booking flow
 */
const startBooking = (phone, reason = null) => {
    setState(phone, {
        step: reason ? BOOKING_STEPS.AWAITING_DATE : BOOKING_STEPS.AWAITING_REASON,
        reason: reason,
        date: null,
        timeSlot: null,
        name: null,
        startedAt: Date.now()
    });
    return getState(phone);
};

/**
 * Set date selection
 */
const setDate = (phone, date) => {
    setState(phone, {
        step: BOOKING_STEPS.AWAITING_SLOT,
        date: date
    });
    return getState(phone);
};

/**
 * Set time slot selection
 */
const setTimeSlot = (phone, timeSlot) => {
    setState(phone, {
        step: BOOKING_STEPS.AWAITING_NAME,
        timeSlot: timeSlot
    });
    return getState(phone);
};

/**
 * Set user name
 */
const setName = (phone, name) => {
    setState(phone, {
        step: BOOKING_STEPS.AWAITING_CONFIRM,
        name: name
    });
    return getState(phone);
};

/**
 * Check if message is a button response for booking
 */
const isBookingAction = (buttonId) => {
    if (!buttonId) return false;
    return buttonId.startsWith('date_') ||
        buttonId.startsWith('slot_') ||
        buttonId.startsWith('confirm_') ||
        buttonId.startsWith('cancel_') ||
        buttonId.startsWith('more_dates_');
};

/**
 * Parse button action
 */
const parseButtonAction = (buttonId) => {
    if (!buttonId) return null;

    if (buttonId.startsWith('date_')) {
        return { type: 'date', value: buttonId.replace('date_', '') };
    }
    if (buttonId.startsWith('slot_')) {
        return { type: 'slot', value: buttonId.replace('slot_', '') };
    }
    if (buttonId.startsWith('confirm_')) {
        return { type: 'confirm', value: buttonId.replace('confirm_', '') };
    }
    if (buttonId.startsWith('cancel_')) {
        return { type: 'cancel', value: true };
    }
    if (buttonId.startsWith('more_dates_')) {
        return { type: 'more_dates', page: parseInt(buttonId.replace('more_dates_', '')) };
    }

    return null;
};

/**
 * Clean up stale booking states (older than 30 minutes)
 */
const cleanupStaleStates = () => {
    const thirtyMinutesAgo = Date.now() - 30 * 60 * 1000;
    for (const [phone, state] of bookingStates.entries()) {
        if (state.updatedAt < thirtyMinutesAgo) {
            bookingStates.delete(phone);
        }
    }
};

// Run cleanup every 10 minutes
setInterval(cleanupStaleStates, 10 * 60 * 1000);

module.exports = {
    BOOKING_STEPS,
    getState,
    setState,
    clearState,
    startBooking,
    setDate,
    setTimeSlot,
    setName,
    isBookingAction,
    parseButtonAction
};
