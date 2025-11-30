import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// Fetch config from backend
let firebaseConfig;
try {
    const response = await fetch('/api/config/firebase');
    firebaseConfig = await response.json();
} catch (e) {
    console.error("Failed to fetch firebase config", e);
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

export const registerUser = async (email, password) => {
    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        return userCredential.user;
    } catch (error) {
        throw error;
    }
};

export const loginUser = async (email, password) => {
    try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        return userCredential.user;
    } catch (error) {
        throw error;
    }
};

export const logoutUser = async () => {
    try {
        await signOut(auth);
        window.location.href = '/login.html';
    } catch (error) {
        console.error("Logout failed", error);
    }
};

export const checkAuth = (callback) => {
    onAuthStateChanged(auth, (user) => {
        if (user) {
            callback(user);
        } else {
            // If not on login/signup page, redirect to login
            if (!window.location.pathname.includes('login.html') && !window.location.pathname.includes('signup.html')) {
                window.location.href = '/login.html';
            }
        }
    });
};

export const getToken = async () => {
    const user = auth.currentUser;
    if (user) {
        return await user.getIdToken();
    }
    return null;
};
