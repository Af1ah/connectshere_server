import { checkAuth, logoutUser } from './auth.js';

let authResolved = false;
let resolveAuthReady;
const authReady = new Promise((resolve) => {
    resolveAuthReady = resolve;
});

export function initAppShell({ activePath }) {
    const body = document.body;

    checkAuth((user) => {
        const email = user.email || 'user';
        const shortName = user.displayName || email.split('@')[0];

        const userName = document.querySelector('[data-user-name]');
        const userRole = document.querySelector('[data-user-role]');
        if (userName) userName.textContent = shortName;
        if (userRole) userRole.textContent = email;

        const navLinks = document.querySelectorAll('.nav a');
        navLinks.forEach((link) => {
            if (link.getAttribute('href') === activePath) {
                link.classList.add('active');
            }
        });

        body.style.visibility = 'visible';

        if (!authResolved) {
            authResolved = true;
            resolveAuthReady(user);
        }
    });

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            await logoutUser();
        });
    }

    const themeBtn = document.getElementById('themeToggle');
    const storedTheme = localStorage.getItem('cs-theme') || 'light';
    document.documentElement.setAttribute('data-theme', storedTheme);

    if (themeBtn) {
        themeBtn.textContent = storedTheme === 'dark' ? 'Light' : 'Dark';
        themeBtn.addEventListener('click', () => {
            const current = document.documentElement.getAttribute('data-theme') || 'light';
            const next = current === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', next);
            localStorage.setItem('cs-theme', next);
            themeBtn.textContent = next === 'dark' ? 'Light' : 'Dark';
        });
    }
}

export function waitForAuth() {
    return authReady;
}
