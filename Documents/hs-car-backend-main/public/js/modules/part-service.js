import { db } from '../../firebase-config.js?v=20260802';
import {
    addDoc,
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    updateDoc
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

const partsCollection = collection(db, 'parts');
const CACHE_KEY = 'hs_all_parts_cache';
let listPartsPromise = null;

function readCache() {
    try {
        const value = sessionStorage.getItem(CACHE_KEY);
        if (!value) return null;
        const parts = JSON.parse(value);
        return Array.isArray(parts) ? parts : null;
    } catch (error) {
        console.warn('Unable to read cached parts:', error);
        return null;
    }
}

function writeCache(parts) {
    try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify(parts));
    } catch (error) {
        console.warn('Unable to cache parts:', error);
    }
}

export async function listParts({ forceRefresh = false } = {}) {
    if (!forceRefresh) {
        const cachedParts = readCache();
        if (cachedParts) return cachedParts;
    }
    if (listPartsPromise) return listPartsPromise;
    listPartsPromise = getDocs(partsCollection)
        .then(snapshot => {
            const parts = snapshot.docs.map(snapshotDoc => ({ id: snapshotDoc.id, ...snapshotDoc.data() }));
            writeCache(parts);
            return parts;
        })
        .finally(() => {
            listPartsPromise = null;
        });
    return listPartsPromise;
}

export async function getPart(partId) {
    const cachedPart = (readCache() || []).find(part => String(part.id) === String(partId));
    if (cachedPart) return cachedPart;
    const snapshot = await getDoc(doc(db, 'parts', partId));
    if (!snapshot.exists()) return null;
    const part = { id: snapshot.id, ...snapshot.data() };
    writeCache([part, ...(readCache() || []).filter(item => String(item.id) !== String(partId))]);
    return part;
}

export function createPart(data) {
    return addDoc(partsCollection, data);
}

export function updatePart(partId, data) {
    return updateDoc(doc(db, 'parts', partId), data).then(() => {
        const parts = readCache() || [];
        const index = parts.findIndex(part => String(part.id) === String(partId));
        if (index >= 0) writeCache(parts.map((part, i) => i === index ? { ...part, ...data } : part));
    });
}

export function deletePart(partId) {
    return deleteDoc(doc(db, 'parts', partId)).then(() => {
        writeCache((readCache() || []).filter(part => String(part.id) !== String(partId)));
    });
}
