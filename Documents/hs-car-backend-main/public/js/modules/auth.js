import { auth, db, googleProvider } from '../../firebase-config.js?v=20260802';
import {
    createUserWithEmailAndPassword,
    fetchSignInMethodsForEmail,
    signInWithEmailAndPassword,
    signInWithPopup,
    signOut,
    updateProfile
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { doc, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

googleProvider.setCustomParameters({ prompt: 'select_account' });

export async function signInWithPassword(email, password) {
    const methods = await fetchSignInMethodsForEmail(auth, email);
    if (methods.includes('google.com') && !methods.includes('password')) {
        const error = new Error('This account uses Google sign-in.');
        error.code = 'auth/google-account';
        throw error;
    }
    return signInWithEmailAndPassword(auth, email, password);
}

export async function registerWithPassword({ email, password, displayName }) {
    const methods = await fetchSignInMethodsForEmail(auth, email);
    if (methods.includes('google.com') && !methods.includes('password')) {
        const error = new Error('This email is registered with Google.');
        error.code = 'auth/google-account';
        throw error;
    }
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    if (displayName) await updateProfile(credential.user, { displayName });
    await setDoc(doc(db, 'users', credential.user.uid), { displayName, email }, { merge: true });
    return credential;
}

export async function signInWithGoogle() {
    const credential = await signInWithPopup(auth, googleProvider);
    await setDoc(doc(db, 'users', credential.user.uid), {
        displayName: credential.user.displayName || '',
        email: credential.user.email || '',
        photoURL: credential.user.photoURL || '',
        avatarUrl: credential.user.photoURL || '',
        avatar: credential.user.photoURL || ''
    }, { merge: true });
    return credential;
}

export function signOutCurrentUser() {
    return signOut(auth);
}

export async function loadUserProfile(user = auth.currentUser) {
    if (!user) return null;
    const snapshot = await getDoc(doc(db, 'users', user.uid));
    return snapshot.exists() ? snapshot.data() : {};
}

export function renderNavbarAuth(user, profile = {}) {
    const container = document.getElementById('nav-auth-container');
    if (!container) return;
    const avatarEl = document.getElementById('nav-avatar-initials');
    const firstEl = document.getElementById('nav-user-firstname');
    const fullNameEl = document.getElementById('nav-ud-fullname');
    const emailEl = document.getElementById('nav-ud-email');
    if (user) {
        const displayName = user.displayName || user.email || 'Konto';
        const avatarUrl = profile.avatarUrl || profile.photoURL || profile.avatar || user.photoURL || '';
        container.className = 'nav-auth-container nav-state-auth';
        if (avatarEl) {
            avatarEl.textContent = avatarUrl ? '' : (displayName[0] || 'U').toUpperCase();
            avatarEl.style.backgroundImage = avatarUrl ? `url("${avatarUrl}")` : '';
            avatarEl.style.backgroundSize = avatarUrl ? 'cover' : '';
            avatarEl.style.backgroundPosition = avatarUrl ? 'center' : '';
        }

        if (firstEl) firstEl.textContent = displayName;
        if (fullNameEl) fullNameEl.textContent = displayName;
        if (emailEl) emailEl.textContent = user.email || '';
        return;
    }
    container.className = 'nav-auth-container nav-state-guest';
    if (avatarEl) {
        avatarEl.textContent = '?';
        avatarEl.style.backgroundImage = '';
    }
    window.closeNavDropdown?.();
}

export function initializeNavbarAuth() {
    renderNavbarAuth(auth.currentUser);
    return onAuthStateChanged(auth, user => {
        renderNavbarAuth(user);
        if (!user) return;
        void loadUserProfile(user)
            .then(profile => renderNavbarAuth(user, profile || {}))
            .catch(error => console.warn('Navbar profile hydration failed:', error));
    });
}
