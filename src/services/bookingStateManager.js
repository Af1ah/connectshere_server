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
 * Check if user is in an active booking flow
 */
const isInBookingFlow = (phone) => {
    const state = getState(phone);
    return state.step !== BOOKING_STEPS.IDLE;
};

/**
 * Clear booking state for a phone number
 */
const clearState = (phone) => {
    bookingStates.delete(phone);
};

/**
 * Start a new booking flow - SMART version
 * @param {string} phone - User phone/booking key
 * @param {string|null} reason - Pre-extracted reason (from conversation)
 * @param {string|null} name - Pre-extracted name (from WhatsApp pushName or conversation)
 */
const startBooking = (phone, reason = null, name = null) => {
    // Determine starting step based on what we already have
    let startStep = BOOKING_STEPS.AWAITING_REASON;
    
    if (reason && name) {
        // We have both - go straight to date selection
        startStep = BOOKING_STEPS.AWAITING_DATE;
    } else if (reason) {
        // We have reason but no name - we'll get name after slot
        startStep = BOOKING_STEPS.AWAITING_DATE;
    }
    // If no reason, we start with AWAITING_REASON
    
    setState(phone, {
        step: startStep,
        reason: reason,
        date: null,
        timeSlot: null,
        name: name, // Store name if available from WhatsApp
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

/**
 * Extract potential booking reason from message
 * Returns reason if found, null otherwise
 */
const extractReasonFromMessage = (message) => {
    if (!message || message.length < 5) return null;
    
    const reasonPatterns = [
        /(?:book(?:ing)?|appointment|consultation|consult)\s+(?:for|about|regarding)?\s*[:"]?\s*(.{5,50})/i,
        /(?:need|want|looking for)\s+(?:help|advice|consultation)\s+(?:with|on|about|for)\s+(.{5,50})/i,
        /(?:regarding|about|for)\s+(.{5,50})$/i,
    ];
    
    for (const pattern of reasonPatterns) {
        const match = message.match(pattern);
        if (match && match[1]) {
            const reason = match[1].trim().replace(/["'.!?]+$/, '').trim();
            if (reason.length >= 3 && reason.length <= 100) {
                return reason;
            }
        }
    }
    
    return null;
};

/**
 * Check if we have enough info to skip steps
 */
const canSkipReasonStep = (phone) => {
    const state = getState(phone);
    return !!state.reason;
};

const canSkipNameStep = (phone) => {
    const state = getState(phone);
    return !!state.name;
};

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
    parseButtonAction,
    isInBookingFlow,
    extractReasonFromMessage,
    canSkipReasonStep,
    canSkipNameStep
};
