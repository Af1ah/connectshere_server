import { getToken } from './auth.js';
import { initAppShell, waitForAuth } from './app-shell.js';

initAppShell({ activePath: 'dashboard.html' });

let currentQR = '';
let statusInterval = null;
let statsInterval = null;

const statusText = document.getElementById('connectionStatusText');
const statusBadge = document.getElementById('connectionStatusBadge');
const showQrBtn = document.getElementById('showQrBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const clearCredsBtn = document.getElementById('clearCredsBtn');

async function authFetch(url, options = {}) {
    const token = await getToken();
    if (!token) throw new Error('No auth token');

    return fetch(url, {
        ...options,
        headers: {
            ...(options.headers || {}),
            Authorization: `Bearer ${token}`
        }
    });
}

async function ensureOkResponse(res, fallbackMessage) {
    if (res.ok) return;

    let message = fallbackMessage;
    try {
        const data = await res.json();
        if (data?.error) message = data.error;
    } catch (e) {
        // Keep fallback message when response body isn't JSON.
    }
    throw new Error(message);
}

function setStatusUI(status) {
    statusText.textContent = status;
    statusBadge.textContent = status;
    statusBadge.className = `status-pill status-${status}`;

    const isDisconnected = status === 'disconnected';
    const isConnecting = status === 'connecting' || status === 'scanning';
    const isConnected = status === 'connected';

    showQrBtn.style.display = isDisconnected ? 'inline-block' : 'none';
    disconnectBtn.style.display = (isConnected || isConnecting) ? 'inline-block' : 'none';
    disconnectBtn.textContent = isConnected ? 'Disconnect' : 'Stop Connecting';
}

function openQrModal(qrData) {
    const modal = document.getElementById('qrModal');
    const qrCodeElement = document.getElementById('qrCode');

    modal.style.display = 'flex';
    qrCodeElement.innerHTML = '';
    currentQR = qrData;

    new QRCode(qrCodeElement, {
        text: qrData,
        width: 260,
        height: 260
    });
}

function closeQrModal() {
    document.getElementById('qrModal').style.display = 'none';
}

async function showQRCode() {
    const res = await authFetch('/api/qr');
    const data = await res.json();
    if (!data.qr) {
        alert('QR is not ready yet. Please try again in a few seconds.');
        return;
    }
    openQrModal(data.qr);
}

async function checkStatus() {
    const res = await authFetch('/api/status');
    const data = await res.json();
    const status = data.status || 'disconnected';

    setStatusUI(status);

    if (status === 'scanning') {
        const qrRes = await authFetch('/api/qr');
        const qrData = await qrRes.json();
        if (qrData.qr && qrData.qr !== currentQR) {
            openQrModal(qrData.qr);
        }
    } else if (status === 'connected') {
        closeQrModal();
    }
}

async function disconnectWhatsApp() {
    try {
        const res = await authFetch('/api/disconnect', { method: 'POST' });
        await ensureOkResponse(res, 'Failed to disconnect WhatsApp.');
        await checkStatus();
    } catch (error) {
        console.error(error);
        alert(error.message || 'Failed to disconnect WhatsApp.');
    }
}

async function clearCredentials() {
    const ok = confirm('This will remove WhatsApp credentials and require a fresh QR scan. Continue?');
    if (!ok) return;
    try {
        const res = await authFetch('/api/credentials', { method: 'DELETE' });
        await ensureOkResponse(res, 'Failed to clear credentials.');
        await checkStatus();
    } catch (error) {
        console.error(error);
        alert(error.message || 'Failed to clear credentials.');
    }
}

async function fetchStats() {
    const res = await authFetch('/api/dashboard/stats');
    const data = await res.json();

    document.getElementById('totalUsers').textContent = data.totalUsers || 0;
    document.getElementById('totalTokens').textContent = (data.totalTokens || 0).toLocaleString();

    let interactions = 0;
    const body = document.getElementById('usersList');
    body.innerHTML = '';

    (data.recentUsers || []).forEach((user) => {
        interactions += user.interactionCount || 0;
        const row = document.createElement('tr');
        const lastActive = user.lastActive?.seconds
            ? new Date(user.lastActive.seconds * 1000).toLocaleString()
            : 'N/A';

        row.innerHTML = `
            <td>${user.id}</td>
            <td>${user.interactionCount || 0}</td>
            <td>${lastActive}</td>
        `;
        body.appendChild(row);
    });

    if (!body.children.length) {
        body.innerHTML = '<tr><td colspan="3" class="muted">No activity yet.</td></tr>';
    }

    document.getElementById('totalInteractions').textContent = `${interactions}+`;
}

function bindEvents() {
    showQrBtn.addEventListener('click', () => showQRCode().catch(console.error));
    disconnectBtn.addEventListener('click', () => disconnectWhatsApp().catch(console.error));
    clearCredsBtn.addEventListener('click', () => clearCredentials().catch(console.error));

    document.getElementById('closeQrModal').addEventListener('click', closeQrModal);
    document.getElementById('qrModal').addEventListener('click', (e) => {
        if (e.target.id === 'qrModal') closeQrModal();
    });
}

waitForAuth().then(async () => {
    bindEvents();
    await Promise.all([checkStatus(), fetchStats()]);

    statusInterval = setInterval(() => checkStatus().catch(console.error), 5000);
    statsInterval = setInterval(() => fetchStats().catch(console.error), 30000);
}).catch(console.error);

window.addEventListener('beforeunload', () => {
    if (statusInterval) clearInterval(statusInterval);
    if (statsInterval) clearInterval(statsInterval);
});
