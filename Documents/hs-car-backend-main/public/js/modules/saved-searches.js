import { auth, db } from './firebase-config.js';
import {
    addDoc,
    collection,
    getDocs,
    orderBy,
    query,
    serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

export async function saveSearchFilter(filterParams) {
    const user = auth.currentUser;
    if (!user?.uid) {
        throw new Error('You must be signed in to save searches.');
    }
    const filters = filterParams && typeof filterParams === 'object' ? filterParams : {};

    try {
        const savedSearchesRef = collection(db, 'users', user.uid, 'savedSearches');
        const payload = {
            ownerId: user.uid,
            filters,
            createdAt: serverTimestamp()
        };
        const added = await addDoc(savedSearchesRef, payload);
        return { id: added.id, ...payload };
    } catch (error) {
        console.error('Failed to save search filter:', error);
        throw error;
    }
}

export async function getUserSavedSearches(userUid) {
    const uid = String(userUid || '').trim();
    if (!uid) {
        throw new Error('userUid is required.');
    }

    try {
        const savedSearchesRef = collection(db, 'users', uid, 'savedSearches');
        const savedSearchesQuery = query(savedSearchesRef, orderBy('createdAt', 'desc'));
        const snapshot = await getDocs(savedSearchesQuery);
        return snapshot.docs.map(docSnap => ({
            id: docSnap.id,
            ...docSnap.data()
        }));
    } catch (error) {
        console.error('Failed to load saved searches:', error);
        throw error;
    }
}

window.saveSearchFilter = saveSearchFilter;
window.getUserSavedSearches = getUserSavedSearches;
