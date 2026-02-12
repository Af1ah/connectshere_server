/* ============================================
   ConnectSphere Dashboard — Logic
   ============================================ */

import { checkAuth, logoutUser, getToken } from './auth.js';

// --- Global State ---
let currentQR = '';
let preventAutoReconnect = false;
let checkStatusInterval = null;
let fetchStatsInterval = null;

// --- Auth Check & Init ---
checkAuth((user) => {
    // Determine display name
    const name = user.displayName || user.email.split('@')[0];
    const role = user.email.includes('admin') ? 'Administrator' : 'User';

    // Update UI
    const nameEl = document.querySelector('.user-name');
    const roleEl = document.querySelector('.user-role');
    const avatarEl = document.querySelector('.avatar');

    if (nameEl) nameEl.textContent = name;
    if (roleEl) roleEl.textContent = role;
    if (avatarEl) avatarEl.textContent = name.charAt(0).toUpperCase();

    console.log(`[Dashboard] Authenticated as ${user.email}`);

    // Initialize Dashboard Data
    initDashboard();

}, () => {
    // If not authenticated, redirect to login
    window.location.href = 'login.html';
});

function initDashboard() {
    checkStatus();
    fetchStats();

    // Auto refresh
    fetchStatsInterval = setInterval(fetchStats, 30000);
    checkStatusInterval = setInterval(checkStatus, 5000);
}

// --- Theme Management ---
const themeBtn = document.getElementById('themeToggle');
const themeIcon = themeBtn.querySelector('i');

function getPreferredTheme() {
    const stored = localStorage.getItem('cs-theme');
    if (stored) return stored;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('cs-theme', theme);

    // Update Icon
    if (themeIcon) {
        if (theme === 'dark') {
            themeIcon.setAttribute('data-lucide', 'moon');
        } else {
            themeIcon.setAttribute('data-lucide', 'sun');
        }
        if (window.lucide) window.lucide.createIcons();
    }
}

// Init Theme
applyTheme(getPreferredTheme());

themeBtn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    applyTheme(current === 'dark' ? 'light' : 'dark');
});

// --- Sidebar Toggle (Mobile) ---
const menuToggle = document.getElementById('menuToggle');
const sidebar = document.getElementById('sidebar');

if (menuToggle && sidebar) {
    menuToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        sidebar.classList.toggle('open');
    });

    // Close sidebar when clicking outside on mobile
    document.addEventListener('click', (e) => {
        if (window.innerWidth <= 900 &&
            sidebar.classList.contains('open') &&
            !sidebar.contains(e.target) &&
            e.target !== menuToggle) {
            sidebar.classList.remove('open');
        }
    });
}

// --- Logout ---
const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
        await logoutUser();
        window.location.href = 'login.html';
    });
}

// --- Status & Connection Logic (Migrated from script.js) ---
async function checkStatus() {
    try {
        const token = await getToken();
        if (!token) return;

        const response = await fetch('/api/status', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        const status = data.status;

        const statusElement = document.getElementById('connectionStatus');
        if (statusElement) {
            statusElement.textContent = status.toUpperCase();

            // Color coding
            if (status === 'connected') statusElement.style.color = 'var(--success)';
            else if (status === 'scanning') statusElement.style.color = 'var(--warning)';
            else statusElement.style.color = 'var(--danger)';
        }

        updateConnectionUI(status);

        // QR Code Logic
        const qrModal = document.getElementById('qrModal');
        const qrCodeElement = document.getElementById('qrCode');

        if (status === 'scanning') {
            const qrResponse = await fetch('/api/qr', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const qrData = await qrResponse.json();

            if (qrData.qr && qrData.qr !== currentQR) {
                currentQR = qrData.qr;
                if (qrModal) {
                    qrModal.style.display = 'flex';
                    qrCodeElement.innerHTML = '';
                    new QRCode(qrCodeElement, {
                        text: currentQR,
                        width: 256,
                        height: 256
                    });
                }
            } else if (!qrData.qr && qrModal) {
                qrModal.style.display = 'none';
            }
        } else if (status === 'connected' && qrModal) {
            qrModal.style.display = 'none';
        }

    } catch (error) {
        console.error('[Dashboard] Status check failed:', error);
    }
}

function updateConnectionUI(status) {
    const disconnectBtn = document.getElementById('disconnectBtn');
    const showQrBtn = document.getElementById('showQrBtn');

    if (disconnectBtn) {
        if (status === 'connected') {
            disconnectBtn.style.display = 'inline-block';
            disconnectBtn.textContent = '🔌 Disconnect';
            disconnectBtn.onclick = disconnectWhatsApp;
        } else if (status === 'connecting' || status === 'scanning') {
            disconnectBtn.style.display = 'inline-block';
            disconnectBtn.textContent = '⏹️ Stop Connecting';
            disconnectBtn.onclick = disconnectWhatsApp; // Same endpoint handles stop
        } else {
            disconnectBtn.style.display = 'none';
        }
    }

    if (showQrBtn) {
        if (status === 'disconnected') {
            showQrBtn.style.display = 'inline-block';
            showQrBtn.onclick = showQRCode;
        } else {
            showQrBtn.style.display = 'none';
        }
    }

    const clearBtn = document.getElementById('clearCredsBtn');
    if (clearBtn) {
        clearBtn.onclick = clearCredentials;
    }

    // Modal Close Logic
    const closeBtn = document.querySelector('.close');
    const qrModal = document.getElementById('qrModal');
    if (closeBtn && qrModal) {
        closeBtn.onclick = () => qrModal.style.display = 'none';
        window.onclick = (event) => {
            if (event.target == qrModal) qrModal.style.display = 'none';
        }
    }
}

async function showQRCode() {
    try {
        const token = await getToken();
        if (!token) return;

        const qrResponse = await fetch('/api/qr', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const qrData = await qrResponse.json();

        if (!qrData.qr) {
            console.warn('QR not available yet, try again in a moment');
            return;
        }

        const qrModal = document.getElementById('qrModal');
        const qrCodeElement = document.getElementById('qrCode');
        currentQR = qrData.qr;

        if (qrModal && qrCodeElement) {
            qrModal.style.display = 'flex';
            qrCodeElement.innerHTML = '';
            new QRCode(qrCodeElement, {
                text: currentQR,
                width: 256,
                height: 256
            });
        }
    } catch (error) {
        console.error('Failed to fetch QR:', error);
    }
}

// --- Actions ---
async function disconnectWhatsApp() {
    const disconnectBtn = document.getElementById('disconnectBtn');
    if (!disconnectBtn) return;

    const originalText = disconnectBtn.textContent;
    disconnectBtn.disabled = true;
    disconnectBtn.textContent = '⏳ ...';

    try {
        const token = await getToken();
        await fetch('/api/disconnect', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        await checkStatus();
    } catch (error) {
        console.error('Disconnect failed:', error);
    } finally {
        disconnectBtn.disabled = false;
        disconnectBtn.textContent = originalText;
    }
}

async function clearCredentials() {
    if (!confirm('This will remove all WhatsApp credentials and require a fresh QR scan. Continue?')) return;

    const clearBtn = document.getElementById('clearCredsBtn');
    const originalText = clearBtn.textContent;
    preventAutoReconnect = true;

    try {
        clearBtn.disabled = true;
        clearBtn.textContent = '⏳ ...';
        const token = await getToken();
        await fetch('/api/credentials', {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        // Update UI logic to allow manual reconnect (omitted complex toggle for simplicity, checkStatus will handle updates)
        document.getElementById('connectionStatus').textContent = 'CLEARED';
        preventAutoReconnect = false; // Allow reconnect on next refresh or manual trigger

        // Force status update
        setTimeout(checkStatus, 1000);

    } catch (error) {
        console.error('Clear creds failed:', error);
    } finally {
        clearBtn.disabled = false;
        clearBtn.textContent = originalText;
    }
}

// --- Stats ---
async function fetchStats() {
    try {
        const token = await getToken();
        if (!token) return;

        const response = await fetch('/api/dashboard/stats', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();

        const usersEl = document.getElementById('totalUsers');
        const tokensEl = document.getElementById('totalTokens');
        const interactionsEl = document.getElementById('totalInteractions');

        if (usersEl) usersEl.textContent = data.totalUsers || 0;
        if (tokensEl) tokensEl.textContent = (data.totalTokens || 0).toLocaleString();

        // Populate Table
        const usersList = document.getElementById('usersList');
        if (usersList && data.recentUsers) {
            usersList.innerHTML = '';
            let totalInteractions = 0;

            data.recentUsers.forEach(user => {
                totalInteractions += (user.interactionCount || 0);
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td style="padding: 16px 24px; border-bottom: 1px solid var(--border-color);">${user.id}</td>
                    <td style="padding: 16px 24px; border-bottom: 1px solid var(--border-color);">${user.interactionCount || 0}</td>
                    <td style="padding: 16px 24px; border-bottom: 1px solid var(--border-color);">${user.lastActive ? new Date(user.lastActive.seconds * 1000).toLocaleString() : 'N/A'}</td>
                `;
                usersList.appendChild(row);
            });

            if (interactionsEl) interactionsEl.textContent = totalInteractions + "+";
        }

    } catch (error) {
        console.error('Fetch stats failed:', error);
    }
}
