import { auth, db } from './firebase-config.js';
import {
    addDoc,
    collection,
    doc,
    getDocs,
    orderBy,
    query,
    serverTimestamp,
    setDoc
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

function normalizeRating(value) {
    const rating = Number(value);
    if (!Number.isFinite(rating)) return 0;
    return Math.min(5, Math.max(1, Math.round(rating)));
}

export async function addDealerReview(sellerUid, rating, comment) {
    const targetUid = String(sellerUid || '').trim();
    const cleanComment = String(comment || '').trim();
    const reviewer = auth.currentUser;
    if (!targetUid) {
        throw new Error('sellerUid is required.');
    }
    if (!reviewer?.uid) {
        throw new Error('You must be signed in to add a review.');
    }
    const finalRating = normalizeRating(rating);
    if (!finalRating) {
        throw new Error('A valid rating between 1 and 5 is required.');
    }
    try {
        const reviewsRef = collection(db, 'users', targetUid, 'reviews');
        const payload = {
            sellerUid: targetUid,
            ownerId: reviewer.uid,
            reviewerUid: reviewer.uid,
            reviewerName: reviewer.displayName || reviewer.email || 'User',
            rating: finalRating,
            comment: cleanComment,
            createdAt: serverTimestamp()
        };
        const added = await addDoc(reviewsRef, payload);
        const stats = await loadDealerReviews(targetUid);
        await setDoc(doc(db, 'users', targetUid), {
            averageRating: stats.averageRating,
            totalReviews: stats.totalReviews
        }, { merge: true });
        return { id: added.id, ...payload };
    } catch (error) {
        console.error('Failed to add dealer review:', error);
        throw error;
    }
}

export async function loadDealerReviews(sellerUid) {
    const targetUid = String(sellerUid || '').trim();
    if (!targetUid) {
        throw new Error('sellerUid is required.');
    }
    try {
        const reviewsRef = collection(db, 'users', targetUid, 'reviews');
        const reviewsQuery = query(reviewsRef, orderBy('createdAt', 'desc'));
        const snapshot = await getDocs(reviewsQuery);
        const reviews = snapshot.docs.map(docSnap => ({
            id: docSnap.id,
            ...docSnap.data()
        }));
        const totalReviews = reviews.length;
        const ratingsSum = reviews.reduce((sum, review) => sum + Number(review.rating || 0), 0);
        const averageRating = totalReviews ? ratingsSum / totalReviews : 0;
        return { reviews, averageRating, totalReviews };
    } catch (error) {
        console.error('Failed to load dealer reviews:', error);
        throw error;
    }
}

window.addDealerReview = addDealerReview;
window.loadDealerReviews = loadDealerReviews;
