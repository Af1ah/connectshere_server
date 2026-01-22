import { getToken } from './auth.js';

let currentQR = '';
let preventAutoReconnect = false; // Flag to prevent auto-reconnect after clearing credentials

async function checkStatus() {
    const startTime = Date.now();
    console.log(`[${new Date().toISOString()}] 🔍 checkStatus() - Starting...`);

    try {
        const token = await getToken();
        if (!token) {
            console.log(`[${new Date().toISOString()}] ❌ checkStatus() - No token available`);
            return;
        }
        console.log(`[${new Date().toISOString()}] ✅ checkStatus() - Token obtained`);

        console.log(`[${new Date().toISOString()}] 📡 checkStatus() - Fetching /api/status...`);
        const response = await fetch('/api/status', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        const status = data.status;
        console.log(`[${new Date().toISOString()}] 🎯 checkStatus() - Received status: ${status}`);

        const statusElement = document.getElementById('connectionStatus');
        statusElement.textContent = status.toUpperCase();
        statusElement.className = status;

        const qrModal = document.getElementById('qrModal');
        const qrContainer = document.getElementById('qrContainer');
        const qrCodeElement = document.getElementById('qrCode');
        const closeBtn = document.getElementsByClassName("close")[0];
        const connectionControls = document.getElementById('connectionControls');

        // Close modal logic
        closeBtn.onclick = function () {
            qrModal.style.display = "none";
        }
        window.onclick = function (event) {
            if (event.target == qrModal) {
                qrModal.style.display = "none";
            }
        }

        // Show/hide connection controls based on status
        // Always show controls so user can clear credentials even when disconnected
        connectionControls.style.display = 'flex';

        // Update disconnect button text/visibility based on status
        const disconnectBtn = document.getElementById('disconnectBtn');
        if (status === 'connected') {
            disconnectBtn.style.display = 'inline-block';
            disconnectBtn.textContent = '🔌 Disconnect';
        } else if (status === 'connecting' || status === 'scanning') {
            disconnectBtn.style.display = 'inline-block';
            disconnectBtn.textContent = '⏹️ Stop Connecting';
        } else {
            disconnectBtn.style.display = 'none';
        }

        if (status === 'connected') {
            qrModal.style.display = 'none';
            statusElement.style.color = '#2ecc71';
        } else if (status === 'scanning') {
            statusElement.style.color = '#f39c12';

            console.log(`[${new Date().toISOString()}] 📡 checkStatus() - Status is SCANNING, fetching QR...`);
            const qrResponse = await fetch('/api/qr', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const qrData = await qrResponse.json();
            console.log(`[${new Date().toISOString()}] 📱 checkStatus() - QR data received:`, qrData.qr ? `${qrData.qr.length} chars` : 'null');

            if (qrData.qr && qrData.qr !== currentQR) {
                currentQR = qrData.qr;
                qrModal.style.display = 'block';
                qrCodeElement.innerHTML = '';
                new QRCode(qrCodeElement, {
                    text: currentQR,
                    width: 256,
                    height: 256
                });
            } else if (!qrData.qr) {
                qrModal.style.display = 'none';
            }
        } else {
            statusElement.style.color = '#e74c3c';
            qrModal.style.display = 'none';

            // Auto-trigger connection if disconnected (unless prevented)
            if (status === 'disconnected' && !preventAutoReconnect) {
                statusElement.textContent = 'CONNECTING...';
                await fetch('/api/qr', {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
            } else if (preventAutoReconnect) {
                statusElement.textContent = 'DISCONNECTED';
            }
        }

    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ checkStatus() - Error:`, error);
    }
    const elapsedTime = Date.now() - startTime;
    console.log(`[${new Date().toISOString()}] ⏱️ checkStatus() - Completed in ${elapsedTime}ms`);
}

async function fetchStats() {
    const startTime = Date.now();
    console.log(`[${new Date().toISOString()}] 📊 fetchStats() - Starting...`);

    try {
        const token = await getToken();
        if (!token) {
            console.log(`[${new Date().toISOString()}] ❌ fetchStats() - No token available`);
            return;
        }

        console.log(`[${new Date().toISOString()}] 📡 fetchStats() - Fetching /api/dashboard/stats...`);
        const response = await fetch('/api/dashboard/stats', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        console.log(`[${new Date().toISOString()}] 📈 fetchStats() - Data received:`, data);

        document.getElementById('totalUsers').textContent = data.totalUsers;
        document.getElementById('totalTokens').textContent = data.totalTokens.toLocaleString();

        let interactions = 0;
        const usersList = document.getElementById('usersList');
        usersList.innerHTML = '';

        if (data.recentUsers) {
            data.recentUsers.forEach(user => {
                interactions += (user.interactionCount || 0);

                const row = document.createElement('tr');
                const lastActive = user.lastActive ? new Date(user.lastActive.seconds * 1000).toLocaleString() : 'N/A';

                row.innerHTML = `
                    <td>${user.id}</td>
                    <td>${user.interactionCount || 0}</td>
                    <td>${lastActive}</td>
                `;
                usersList.appendChild(row);
            });
        }

        document.getElementById('totalInteractions').textContent = interactions + "+";

    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ fetchStats() - Error:`, error);
    }
    const elapsedTime = Date.now() - startTime;
    console.log(`[${new Date().toISOString()}] ⏱️ fetchStats() - Completed in ${elapsedTime}ms`);
}

window.fetchStats = fetchStats;

async function disconnectWhatsApp() {
    const disconnectBtn = document.getElementById('disconnectBtn');
    const originalText = disconnectBtn.textContent;

    try {
        disconnectBtn.disabled = true;
        disconnectBtn.textContent = '⏳ Disconnecting...';

        const token = await getToken();
        if (!token) {
            console.log(`[${new Date().toISOString()}] ❌ disconnectWhatsApp() - No token available`);
            return;
        }

        console.log(`[${new Date().toISOString()}] 🔌 disconnectWhatsApp() - Sending disconnect request...`);
        const response = await fetch('/api/disconnect', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        console.log(`[${new Date().toISOString()}] ✅ disconnectWhatsApp() - Response:`, data);

        // Refresh status immediately
        await checkStatus();

    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ disconnectWhatsApp() - Error:`, error);
    } finally {
        disconnectBtn.disabled = false;
        disconnectBtn.textContent = originalText;
    }
}

async function clearCredentials() {
    if (!confirm('This will remove all WhatsApp credentials and require a fresh QR scan. Continue?')) {
        return;
    }

    const clearBtn = document.getElementById('clearCredsBtn');
    const originalText = clearBtn.textContent;

    try {
        // Prevent auto-reconnect so credentials can be fully cleared
        preventAutoReconnect = true;

        clearBtn.disabled = true;
        clearBtn.textContent = '⏳ Clearing...';

        const token = await getToken();
        if (!token) {
            console.log(`[${new Date().toISOString()}] ❌ clearCredentials() - No token available`);
            return;
        }

        console.log(`[${new Date().toISOString()}] 🗑️ clearCredentials() - Sending clear request...`);
        const response = await fetch('/api/credentials', {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        console.log(`[${new Date().toISOString()}] ✅ clearCredentials() - Response:`, data);

        // Update status display
        const statusElement = document.getElementById('connectionStatus');
        statusElement.textContent = 'CLEARED - Click Connect';
        statusElement.style.color = '#3498db';

        // Change button to allow manual reconnect
        clearBtn.textContent = '🔗 Connect Now';
        clearBtn.onclick = async () => {
            preventAutoReconnect = false;
            clearBtn.textContent = originalText;
            clearBtn.onclick = clearCredentials;
            await checkStatus();
        };

    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ clearCredentials() - Error:`, error);
        clearBtn.disabled = false;
        clearBtn.textContent = originalText;
        preventAutoReconnect = false;
    }
}

// Expose functions to window for onclick handlers
window.disconnectWhatsApp = disconnectWhatsApp;
window.clearCredentials = clearCredentials;

// Initial load - wait for auth
document.addEventListener('user-logged-in', () => {
    fetchStats();
    checkStatus();

    // Auto refresh
    setInterval(fetchStats, 30000);
    setInterval(checkStatus, 5000);
});
