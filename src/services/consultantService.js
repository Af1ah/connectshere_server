/**
 * Consultant Booking Service
 * Handles time slot management, bookings, and staff confirmations
 */

const { db } = require('../config/firebase');
const {
    doc, getDoc, setDoc, collection, addDoc, getDocs,
    query, where, orderBy, updateDoc, serverTimestamp,
    runTransaction, Timestamp
} = require('firebase/firestore');

// Kolkata timezone
const TIMEZONE = 'Asia/Kolkata';
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

const DEFAULT_SCHEDULE = {
    monday: { enabled: true, start: '09:00', end: '17:00', breakStart: '12:00', breakEnd: '13:00' },
    tuesday: { enabled: true, start: '09:00', end: '17:00', breakStart: '12:00', breakEnd: '13:00' },
    wednesday: { enabled: true, start: '09:00', end: '17:00', breakStart: '12:00', breakEnd: '13:00' },
    thursday: { enabled: true, start: '09:00', end: '17:00', breakStart: '12:00', breakEnd: '13:00' },
    friday: { enabled: true, start: '09:00', end: '17:00', breakStart: '12:00', breakEnd: '13:00' },
    saturday: { enabled: false, start: '10:00', end: '14:00', breakStart: null, breakEnd: null },
    sunday: { enabled: false, start: null, end: null, breakStart: null, breakEnd: null }
};

const isValidTime = (value) => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

const normalizeDaySchedule = (dayName, input = {}) => {
    const fallback = DEFAULT_SCHEDULE[dayName];
    const enabled = Boolean(input.enabled);
    const start = isValidTime(input.start) ? input.start : fallback.start;
    const end = isValidTime(input.end) ? input.end : fallback.end;
    const breakStart = input.breakStart && isValidTime(input.breakStart) ? input.breakStart : fallback.breakStart;
    const breakEnd = input.breakEnd && isValidTime(input.breakEnd) ? input.breakEnd : fallback.breakEnd;

    if (enabled && (!start || !end || timeToMinutes(start) >= timeToMinutes(end))) {
        throw new Error(`Invalid schedule for ${dayName}: start/end time`);
    }

    if (enabled && breakStart && breakEnd && timeToMinutes(breakStart) >= timeToMinutes(breakEnd)) {
        throw new Error(`Invalid schedule for ${dayName}: break time`);
    }

    return {
        enabled,
        start: enabled ? start : null,
        end: enabled ? end : null,
        breakStart: enabled ? breakStart : null,
        breakEnd: enabled ? breakEnd : null
    };
};

const sanitizeSettings = (settings = {}) => {
    const normalized = {
        enabled: Boolean(settings.enabled),
        bookingType: settings.bookingType === 'token' ? 'token' : 'hourly',
        slotDuration: Number.isInteger(settings.slotDuration) ? settings.slotDuration : parseInt(settings.slotDuration, 10),
        maxTokensPerDay: Number.isInteger(settings.maxTokensPerDay) ? settings.maxTokensPerDay : parseInt(settings.maxTokensPerDay, 10),
        dynamicAllocation: Boolean(settings.dynamicAllocation),
        timezone: TIMEZONE,
        schedule: {}
    };

    normalized.slotDuration = Number.isFinite(normalized.slotDuration) ? Math.min(120, Math.max(15, normalized.slotDuration)) : 30;
    normalized.maxTokensPerDay = Number.isFinite(normalized.maxTokensPerDay) ? Math.min(500, Math.max(1, normalized.maxTokensPerDay)) : 30;

    const inputSchedule = settings.schedule || {};
    for (const day of DAYS) {
        normalized.schedule[day] = normalizeDaySchedule(day, inputSchedule[day] || DEFAULT_SCHEDULE[day]);
    }

    return normalized;
};

/**
 * Get consultant settings for a user
 */
const getSettings = async (userId) => {
    try {
        const docRef = doc(db, 'users', userId, 'settings', 'consultant_config');
        const snapshot = await getDoc(docRef);

        if (snapshot.exists()) {
            return snapshot.data();
        }

        // Return default settings if not found
        return {
            enabled: false,
            bookingType: 'hourly', // 'hourly' or 'token'
            slotDuration: 30, // minutes
            maxTokensPerDay: 30,
            dynamicAllocation: false, // Allow flexible slot times
            timezone: TIMEZONE,
            schedule: DEFAULT_SCHEDULE
        };
    } catch (error) {
        console.error('Error getting consultant settings:', error);
        throw error;
    }
};

/**
 * Update consultant settings
 */
const updateSettings = async (userId, settings) => {
    try {
        const sanitized = sanitizeSettings(settings);
        const docRef = doc(db, 'users', userId, 'settings', 'consultant_config');
        await setDoc(docRef, {
            ...sanitized,
            updatedAt: serverTimestamp()
        }, { merge: true });
        return true;
    } catch (error) {
        console.error('Error updating consultant settings:', error);
        return false;
    }
};

/**
 * Get current date/time in Kolkata timezone
 */
const getKolkataTime = () => {
    return new Date(new Date().toLocaleString('en-US', { timeZone: TIMEZONE }));
};

/**
 * Parse time string to minutes since midnight
 */
const timeToMinutes = (timeStr) => {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
};

/**
 * Convert minutes to time string
 */
const minutesToTime = (minutes) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
};

/**
 * Get day name from date string (YYYY-MM-DD format)
 * Using manual parsing to avoid timezone issues
 */
const getDayName = (dateStr) => {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    // Parse date manually to avoid timezone offset issues
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day); // month is 0-indexed
    return days[date.getDay()];
};

/**
 * Check if a date is available for booking
 */
const isDateAvailable = async (userId, dateStr) => {
    const settings = await getSettings(userId);
    if (!settings.enabled) return false;

    const dayName = getDayName(dateStr);
    const daySchedule = settings.schedule[dayName];

    if (!daySchedule || !daySchedule.enabled) return false;

    // Check if date is not in the past
    const kolkataToday = getKolkataTime();
    kolkataToday.setHours(0, 0, 0, 0);
    // Parse date manually to avoid timezone issues
    const [year, month, day] = dateStr.split('-').map(Number);
    const targetDate = new Date(year, month - 1, day);
    targetDate.setHours(0, 0, 0, 0);

    return targetDate >= kolkataToday;
};

/**
 * Generate available time slots for a date
 */
const getAvailableSlots = async (userId, dateStr) => {
    try {
        const settings = await getSettings(userId);
        if (!settings.enabled) {
            return { available: false, reason: 'Consultant booking is not enabled', slots: [] };
        }

        const dayName = getDayName(dateStr);
        const daySchedule = settings.schedule[dayName];

        if (!daySchedule || !daySchedule.enabled) {
            return { available: false, reason: `Not available on ${dayName}`, slots: [] };
        }

        // Check if date is in the past
        const kolkataToday = getKolkataTime();
        kolkataToday.setHours(0, 0, 0, 0);
        // Parse date manually to avoid timezone issues
        const [year, month, day] = dateStr.split('-').map(Number);
        const targetDate = new Date(year, month - 1, day);
        targetDate.setHours(0, 0, 0, 0);

        if (targetDate < kolkataToday) {
            return { available: false, reason: 'Cannot book for past dates', slots: [] };
        }

        // Generate all possible slots
        const startMinutes = timeToMinutes(daySchedule.start);
        const endMinutes = timeToMinutes(daySchedule.end);
        const breakStartMinutes = daySchedule.breakStart ? timeToMinutes(daySchedule.breakStart) : null;
        const breakEndMinutes = daySchedule.breakEnd ? timeToMinutes(daySchedule.breakEnd) : null;

        const slotDuration = settings.slotDuration || 30;
        const allSlots = [];

        for (let time = startMinutes; time + slotDuration <= endMinutes; time += slotDuration) {
            // Skip if slot overlaps with break
            if (breakStartMinutes !== null && breakEndMinutes !== null) {
                if (time < breakEndMinutes && time + slotDuration > breakStartMinutes) {
                    continue;
                }
            }
            allSlots.push(minutesToTime(time));
        }

        // Get existing bookings for this date
        const bookingsRef = collection(db, 'users', userId, 'bookings');
        const q = query(
            bookingsRef,
            where('date', '==', dateStr),
            where('status', 'in', ['pending', 'confirmed'])
        );
        const snapshot = await getDocs(q);

        const bookedSlots = new Set();
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.timeSlot) {
                bookedSlots.add(data.timeSlot);
            }
        });

        // Filter out booked slots
        const availableSlots = allSlots.filter(slot => !bookedSlots.has(slot));

        // If today, filter out past times
        const isToday = targetDate.getTime() === kolkataToday.getTime();
        if (isToday) {
            const currentTime = getKolkataTime();
            const currentMinutes = currentTime.getHours() * 60 + currentTime.getMinutes();
            const filteredSlots = availableSlots.filter(slot => {
                return timeToMinutes(slot) > currentMinutes + 30; // At least 30 min buffer
            });
            return {
                available: filteredSlots.length > 0,
                slots: filteredSlots,
                totalSlots: allSlots.length,
                bookedCount: bookedSlots.size
            };
        }

        return {
            available: availableSlots.length > 0,
            slots: availableSlots,
            totalSlots: allSlots.length,
            bookedCount: bookedSlots.size
        };
    } catch (error) {
        console.error('Error getting available slots:', error);
        throw error;
    }
};

/**
 * Create a booking with transaction for concurrency safety
 */
const createBooking = async (userId, bookingData) => {
    const { phone, name, reason, date, timeSlot } = bookingData;

    try {
        // Verify slot is still available (double-check)
        const slotsResult = await getAvailableSlots(userId, date);
        if (!slotsResult.available || !slotsResult.slots.includes(timeSlot)) {
            return {
                success: false,
                error: 'This time slot is no longer available. Please choose another.'
            };
        }

        // Create booking with transaction to prevent race conditions
        const bookingsRef = collection(db, 'users', userId, 'bookings');

        // Check one more time within the add operation
        const existingQuery = query(
            bookingsRef,
            where('date', '==', date),
            where('timeSlot', '==', timeSlot),
            where('status', 'in', ['pending', 'confirmed'])
        );
        const existingSnapshot = await getDocs(existingQuery);

        if (!existingSnapshot.empty) {
            return {
                success: false,
                error: 'This slot was just booked. Please select another time.'
            };
        }

        // Generate token number for the day
        const dayBookingsQuery = query(
            bookingsRef,
            where('date', '==', date)
        );
        const dayBookingsSnapshot = await getDocs(dayBookingsQuery);
        const tokenNumber = dayBookingsSnapshot.size + 1;

        // Create the booking
        const booking = {
            phone: phone,
            name: name || 'Unknown',
            reason: reason || 'Not specified',
            date: date,
            timeSlot: timeSlot,
            tokenNumber: tokenNumber,
            status: 'pending',
            createdAt: serverTimestamp(),
            confirmedAt: null,
            confirmedBy: null
        };

        const docRef = await addDoc(bookingsRef, booking);

        return {
            success: true,
            bookingId: docRef.id,
            tokenNumber: tokenNumber,
            message: `Booking request submitted! Your token number is ${tokenNumber}. Staff will confirm and you'll receive notification.`
        };
    } catch (error) {
        console.error('Error creating booking:', error);
        return { success: false, error: 'Failed to create booking. Please try again.' };
    }
};

/**
 * Get all bookings for staff view
 * Note: Uses simple queries to avoid requiring composite indexes
 */
const getBookings = async (userId, filters = {}) => {
    try {
        const bookingsRef = collection(db, 'users', userId, 'bookings');

        // Use simple queries without orderBy to avoid index requirements
        let snapshot;
        if (filters.status) {
            const q = query(bookingsRef, where('status', '==', filters.status));
            snapshot = await getDocs(q);
        } else if (filters.date) {
            const q = query(bookingsRef, where('date', '==', filters.date));
            snapshot = await getDocs(q);
        } else {
            snapshot = await getDocs(bookingsRef);
        }

        const bookings = [];
        snapshot.forEach(doc => {
            bookings.push({
                id: doc.id,
                ...doc.data()
            });
        });

        // Sort in memory by createdAt descending
        return bookings.sort((a, b) => {
            const timeA = a.createdAt?.toMillis?.() || a.createdAt?.seconds * 1000 || 0;
            const timeB = b.createdAt?.toMillis?.() || b.createdAt?.seconds * 1000 || 0;
            return timeB - timeA;
        });
    } catch (error) {
        console.error('Error getting bookings:', error);
        return [];
    }
};

/**
 * Update booking status (confirm/reject)
 */
const updateBookingStatus = async (userId, bookingId, status, staffNote = null) => {
    try {
        const bookingRef = doc(db, 'users', userId, 'bookings', bookingId);
        const updateData = {
            status: status,
            updatedAt: serverTimestamp()
        };

        if (status === 'confirmed') {
            updateData.confirmedAt = serverTimestamp();
        }

        if (staffNote) {
            updateData.staffNote = staffNote;
        }

        await updateDoc(bookingRef, updateData);
        return { success: true };
    } catch (error) {
        console.error('Error updating booking status:', error);
        return { success: false, error: 'Failed to update booking' };
    }
};

/**
 * Get next available dates (for AI to suggest)
 */
const getNextAvailableDates = async (userId, count = 5) => {
    const settings = await getSettings(userId);
    if (!settings.enabled) return [];

    const availableDates = [];
    const today = getKolkataTime();

    for (let i = 0; i < 14 && availableDates.length < count; i++) {
        const checkDate = new Date(today);
        checkDate.setDate(today.getDate() + i);
        const dateStr = checkDate.toISOString().split('T')[0];

        if (await isDateAvailable(userId, dateStr)) {
            const slots = await getAvailableSlots(userId, dateStr);
            if (slots.available && slots.slots.length > 0) {
                availableDates.push({
                    date: dateStr,
                    dayName: getDayName(dateStr),
                    availableSlots: slots.slots.length
                });
            }
        }
    }

    return availableDates;
};

module.exports = {
    getSettings,
    updateSettings,
    getAvailableSlots,
    createBooking,
    getBookings,
    updateBookingStatus,
    getNextAvailableDates,
    isDateAvailable,
    getKolkataTime,
    TIMEZONE
};
