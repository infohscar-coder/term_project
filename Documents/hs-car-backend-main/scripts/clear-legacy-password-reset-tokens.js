import 'dotenv/config';
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldPath, FieldValue, getFirestore } from 'firebase-admin/firestore';

const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
let credential = applicationDefault();
if (serviceAccountJson) {
    try {
        credential = cert(JSON.parse(serviceAccountJson));
    } catch (error) {
        throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON must contain valid service-account JSON.', { cause: error });
    }
}

const app = getApps().length
    ? getApps()[0]
    : initializeApp({ credential });
const db = getFirestore(app);
const pageSize = 400;
let lastDocument = null;
let cleanedDocuments = 0;

while (true) {
    let usersQuery = db.collection('users')
        .orderBy(FieldPath.documentId())
        .limit(pageSize);
    if (lastDocument) usersQuery = usersQuery.startAfter(lastDocument);

    const snapshot = await usersQuery.get();
    if (snapshot.empty) break;

    const batch = db.batch();
    let batchSize = 0;
    for (const userSnapshot of snapshot.docs) {
        const userData = userSnapshot.data();
        const hasLegacyToken = Object.prototype.hasOwnProperty.call(userData, 'resetToken')
            || Object.prototype.hasOwnProperty.call(userData, 'resetTokenExpiry');
        if (!hasLegacyToken) continue;

        batch.update(userSnapshot.ref, {
            resetToken: FieldValue.delete(),
            resetTokenExpiry: FieldValue.delete()
        });
        batchSize += 1;
    }

    if (batchSize > 0) {
        await batch.commit();
        cleanedDocuments += batchSize;
    }

    lastDocument = snapshot.docs[snapshot.docs.length - 1];
    if (snapshot.size < pageSize) break;
}

console.log(`Removed legacy password-reset fields from ${cleanedDocuments} user document(s).`);
