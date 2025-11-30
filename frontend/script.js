import { getToken } from './auth.js';

let currentQR = '';

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

        // Close modal logic
        closeBtn.onclick = function () {
            qrModal.style.display = "none";
        }
        window.onclick = function (event) {
            if (event.target == qrModal) {
                qrModal.style.display = "none";
            }
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

            // Auto-trigger connection if disconnected
            if (status === 'disconnected') {
                statusElement.textContent = 'CONNECTING...';
                await fetch('/api/qr', {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
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

// Initial load - wait for auth
document.addEventListener('user-logged-in', () => {
    fetchStats();
    checkStatus();

    // Auto refresh
    setInterval(fetchStats, 30000);
    setInterval(checkStatus, 5000);
});
