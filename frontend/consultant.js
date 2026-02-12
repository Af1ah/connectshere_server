import { getToken } from './auth.js';
import { initAppShell, waitForAuth } from './app-shell.js';

initAppShell({ activePath: 'consultant-test.html' });

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
let selectedSlot = null;
let currentFilter = '';

const messageEl = document.getElementById('message');
const bookingsEl = document.getElementById('bookingsList');

function showMessage(text, type = 'success') {
    messageEl.className = `message ${type}`;
    messageEl.textContent = text;
    setTimeout(() => {
        messageEl.className = 'message';
        messageEl.textContent = '';
    }, 3500);
}

async function authFetch(path, options = {}) {
    const token = await getToken();
    if (!token) throw new Error('No auth token');

    const headers = {
        ...(options.headers || {}),
        Authorization: `Bearer ${token}`
    };

    if (options.body && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
    }

    return fetch(`/api${path}`, {
        ...options,
        headers
    });
}

function collectSettingsPayload() {
    const schedule = {};
    DAYS.forEach((day) => {
        schedule[day] = {
            enabled: document.getElementById(`${day}-enabled`).checked,
            start: document.getElementById(`${day}-start`).value,
            end: document.getElementById(`${day}-end`).value,
            breakStart: document.getElementById(`${day}-break-start`).value || null,
            breakEnd: document.getElementById(`${day}-break-end`).value || null
        };
    });

    return {
        enabled: document.getElementById('enabled').checked,
        bookingType: document.getElementById('bookingType').value,
        slotDuration: parseInt(document.getElementById('slotDuration').value, 10),
        maxTokensPerDay: parseInt(document.getElementById('maxTokens').value, 10),
        dynamicAllocation: document.getElementById('dynamicAllocation').checked,
        schedule
    };
}

function applySettings(settings) {
    document.getElementById('enabled').checked = Boolean(settings.enabled);
    document.getElementById('bookingType').value = settings.bookingType || 'hourly';
    document.getElementById('slotDuration').value = settings.slotDuration || 30;
    document.getElementById('maxTokens').value = settings.maxTokensPerDay || 30;
    document.getElementById('dynamicAllocation').checked = Boolean(settings.dynamicAllocation);

    const schedule = settings.schedule || {};
    DAYS.forEach((day) => {
        const s = schedule[day] || {};
        document.getElementById(`${day}-enabled`).checked = Boolean(s.enabled);
        document.getElementById(`${day}-start`).value = s.start || '09:00';
        document.getElementById(`${day}-end`).value = s.end || '17:00';
        document.getElementById(`${day}-break-start`).value = s.breakStart || '';
        document.getElementById(`${day}-break-end`).value = s.breakEnd || '';
    });
}

async function loadSettings() {
    const res = await authFetch('/consultant/settings');
    const data = await res.json();
    applySettings(data);
}

async function saveSettings() {
    try {
        const payload = collectSettingsPayload();
        const res = await authFetch('/consultant/settings', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to save settings');
        showMessage(data.message || 'Settings saved');
    } catch (error) {
        showMessage(error.message, 'error');
    }
}

async function loadSlots() {
    const date = document.getElementById('bookingDate').value;
    const slotGrid = document.getElementById('slotsGrid');
    selectedSlot = null;

    if (!date) {
        slotGrid.innerHTML = '<div class="muted">Pick a date to view available slots.</div>';
        return;
    }

    const res = await authFetch(`/consultant/slots/${date}`);
    const data = await res.json();

    if (!data.available) {
        slotGrid.innerHTML = `<div class="muted">${data.reason || 'No slots available'}</div>`;
        return;
    }

    slotGrid.innerHTML = '';
    data.slots.forEach((slot) => {
        const btn = document.createElement('button');
        btn.textContent = slot;
        btn.addEventListener('click', () => {
            slotGrid.querySelectorAll('button').forEach((n) => n.classList.remove('primary'));
            btn.classList.add('primary');
            selectedSlot = slot;
        });
        slotGrid.appendChild(btn);
    });
}

async function createBooking() {
    if (!selectedSlot) {
        showMessage('Please select a slot first', 'error');
        return;
    }

    const payload = {
        phone: document.getElementById('customerPhone').value.trim(),
        name: document.getElementById('customerName').value.trim(),
        reason: document.getElementById('customerReason').value.trim(),
        date: document.getElementById('bookingDate').value,
        timeSlot: selectedSlot
    };

    if (!payload.phone || !payload.date) {
        showMessage('Phone and date are required', 'error');
        return;
    }

    const res = await authFetch('/consultant/bookings', {
        method: 'POST',
        body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (!res.ok || !data.success) {
        showMessage(data.error || 'Booking failed', 'error');
        return;
    }

    showMessage(data.message || 'Booking created');
    document.getElementById('customerPhone').value = '';
    document.getElementById('customerName').value = '';
    document.getElementById('customerReason').value = '';
    await loadSlots();
    await loadBookings();
}

async function updateBookingStatus(bookingId, status) {
    const res = await authFetch(`/consultant/bookings/${bookingId}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status })
    });
    const data = await res.json();

    if (!res.ok) {
        showMessage(data.error || 'Status update failed', 'error');
        return;
    }

    showMessage(data.message || 'Status updated');
    await loadBookings();
}

function renderBookings(bookings) {
    bookingsEl.innerHTML = '';
    if (!bookings.length) {
        bookingsEl.innerHTML = '<div class="muted">No bookings found.</div>';
        return;
    }

    bookings.forEach((booking) => {
        const card = document.createElement('div');
        card.className = 'list-item';
        card.innerHTML = `
            <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap">
                <strong>Token #${booking.tokenNumber || '-'}</strong>
                <span class="badge">${booking.status}</span>
            </div>
            <div class="muted">${booking.name || 'Unknown'} • ${booking.phone || '-'}</div>
            <div class="muted">${booking.date || '-'} at ${booking.timeSlot || '-'}</div>
            <div class="muted">${booking.reason || 'No reason provided'}</div>
            <div class="inline-actions" style="margin-top:8px"></div>
        `;

        if (booking.status === 'pending') {
            const actions = card.querySelector('.inline-actions');
            const confirmBtn = document.createElement('button');
            confirmBtn.className = 'primary';
            confirmBtn.textContent = 'Confirm';
            confirmBtn.addEventListener('click', () => updateBookingStatus(booking.id, 'confirmed'));

            const rejectBtn = document.createElement('button');
            rejectBtn.className = 'danger';
            rejectBtn.textContent = 'Reject';
            rejectBtn.addEventListener('click', () => updateBookingStatus(booking.id, 'rejected'));

            actions.appendChild(confirmBtn);
            actions.appendChild(rejectBtn);
        }

        bookingsEl.appendChild(card);
    });
}

async function loadBookings() {
    const endpoint = currentFilter ? `/consultant/bookings?status=${currentFilter}` : '/consultant/bookings';
    const res = await authFetch(endpoint);
    const data = await res.json();
    renderBookings(data.bookings || []);
}

function initTabs() {
    document.querySelectorAll('[data-tab]').forEach((btn) => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('[data-tab]').forEach((el) => el.classList.remove('active'));
            document.querySelectorAll('.tab-panel').forEach((el) => el.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(btn.dataset.tab).classList.add('active');
        });
    });

    document.querySelectorAll('[data-booking-filter]').forEach((btn) => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('[data-booking-filter]').forEach((el) => el.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.dataset.bookingFilter;
            loadBookings().catch((error) => showMessage(error.message, 'error'));
        });
    });
}

function initScheduleUI() {
    const wrap = document.getElementById('scheduleGrid');
    wrap.innerHTML = DAYS.map((day) => `
        <div class="schedule-row">
            <strong>${day[0].toUpperCase() + day.slice(1)}</strong>
            <label style="margin:0"><input id="${day}-enabled" type="checkbox"> On</label>
            <input id="${day}-start" type="time" aria-label="${day} start">
            <input id="${day}-end" type="time" aria-label="${day} end">
            <input id="${day}-break-start" type="time" aria-label="${day} break start">
            <input id="${day}-break-end" type="time" aria-label="${day} break end">
        </div>
    `).join('');
}

const today = new Date().toISOString().split('T')[0];
document.getElementById('bookingDate').value = today;

initScheduleUI();
initTabs();

document.getElementById('saveSettingsBtn').addEventListener('click', saveSettings);
document.getElementById('createBookingBtn').addEventListener('click', createBooking);
document.getElementById('bookingDate').addEventListener('change', () => loadSlots().catch((e) => showMessage(e.message, 'error')));

waitForAuth().then(() => {
    return Promise.all([loadSettings(), loadBookings(), loadSlots()]);
}).catch((error) => {
    showMessage(error.message || 'Failed to load consultant console', 'error');
});
