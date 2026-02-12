import { getToken } from './auth.js';
import { initAppShell, waitForAuth } from './app-shell.js';

initAppShell({ activePath: 'ai.html' });

const msg = document.getElementById('message');
const modelSelect = document.getElementById('modelSelect');
const contextInput = document.getElementById('contextInput');
const knowledgeList = document.getElementById('knowledgeList');
const saveBtn = document.getElementById('saveBtn');
const addKnowledgeBtn = document.getElementById('addKnowledgeBtn');
const uploadBtn = document.getElementById('uploadBtn');

const showMessage = (text, type = 'success') => {
    msg.className = `message ${type}`;
    msg.textContent = text;
    setTimeout(() => {
        msg.className = 'message';
        msg.textContent = '';
    }, 3000);
};

async function authFetch(url, options = {}) {
    const token = await getToken();
    if (!token) throw new Error('No auth token');

    const headers = {
        ...(options.headers || {}),
        Authorization: `Bearer ${token}`
    };

    return fetch(url, { ...options, headers });
}

async function loadSettings() {
    const res = await authFetch('/api/settings/ai');
    const data = await res.json();

    modelSelect.innerHTML = '';
    (data.availableModels || []).forEach((model) => {
        const option = document.createElement('option');
        option.value = model;
        option.textContent = model;
        if (model === data.model) option.selected = true;
        modelSelect.appendChild(option);
    });

    contextInput.value = data.context || '';
}

async function saveSettings() {
    saveBtn.disabled = true;
    try {
        const res = await authFetch('/api/settings/ai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: modelSelect.value,
                context: contextInput.value.trim()
            })
        });

        if (!res.ok) throw new Error('Save failed');
        showMessage('AI runtime settings saved.');
    } catch (error) {
        showMessage(error.message || 'Failed to save settings', 'error');
    } finally {
        saveBtn.disabled = false;
    }
}

function renderKnowledge(entries) {
    knowledgeList.innerHTML = '';
    if (!entries.length) {
        knowledgeList.innerHTML = '<div class="muted">No knowledge sources yet.</div>';
        return;
    }

    entries.forEach((entry) => {
        const row = document.createElement('div');
        row.className = 'list-item';
        row.innerHTML = `
            <strong>${entry.source}</strong>
            <div class="muted">${entry.category} • ${entry.chunks} chunks</div>
            <div style="margin-top:8px">
                <button class="danger" data-source="${encodeURIComponent(entry.source)}">Delete</button>
            </div>
        `;
        row.querySelector('button').addEventListener('click', async (ev) => {
            const source = ev.target.getAttribute('data-source');
            if (!confirm(`Delete all chunks from ${decodeURIComponent(source)}?`)) return;
            const res = await authFetch(`/api/knowledge/${source}`, { method: 'DELETE' });
            if (res.ok) {
                showMessage('Knowledge source deleted.');
                await loadKnowledge();
            } else {
                showMessage('Delete failed', 'error');
            }
        });
        knowledgeList.appendChild(row);
    });
}

async function loadKnowledge() {
    const res = await authFetch('/api/knowledge');
    const data = await res.json();
    renderKnowledge(data.entries || []);
}

async function addKnowledge() {
    const source = document.getElementById('knowledgeSource').value.trim() || 'manual';
    const category = document.getElementById('knowledgeCategory').value;
    const content = document.getElementById('knowledgeContent').value.trim();

    if (!content) {
        showMessage('Knowledge content is required', 'error');
        return;
    }

    addKnowledgeBtn.disabled = true;
    try {
        const res = await authFetch('/api/knowledge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source, category, content })
        });
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || 'Add failed');

        document.getElementById('knowledgeContent').value = '';
        document.getElementById('knowledgeSource').value = '';
        showMessage(`Knowledge added (${data.chunksAdded} chunks).`);
        await loadKnowledge();
    } catch (error) {
        showMessage(error.message || 'Add failed', 'error');
    } finally {
        addKnowledgeBtn.disabled = false;
    }
}

async function uploadKnowledgeFile() {
    const fileInput = document.getElementById('fileInput');
    const file = fileInput.files[0];

    if (!file) {
        showMessage('Choose a file first', 'error');
        return;
    }

    uploadBtn.disabled = true;
    try {
        const token = await getToken();
        const formData = new FormData();
        formData.append('file', file);

        const res = await fetch('/api/settings/upload', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: formData
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Upload failed');

        showMessage(`File trained (${data.chunksAdded} chunks).`);
        fileInput.value = '';
        await loadKnowledge();
    } catch (error) {
        showMessage(error.message || 'Upload failed', 'error');
    } finally {
        uploadBtn.disabled = false;
    }
}

saveBtn.addEventListener('click', saveSettings);
addKnowledgeBtn.addEventListener('click', addKnowledge);
uploadBtn.addEventListener('click', uploadKnowledgeFile);

waitForAuth().then(() => {
    return Promise.all([loadSettings(), loadKnowledge()]);
}).catch((error) => {
    showMessage(error.message || 'Failed to load AI console', 'error');
});
