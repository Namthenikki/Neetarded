import { initializeApp, getApps, cert, type ServiceAccount } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { getFirestore } from 'firebase-admin/firestore';

/**
 * Initialize Firebase Admin SDK.
 * Uses environment variables for the service account credentials.
 * 
 * Required env vars:
 *   FIREBASE_PROJECT_ID
 *   FIREBASE_CLIENT_EMAIL
 *   FIREBASE_PRIVATE_KEY (the PEM key string, with \n newlines)
 */
function getAdminApp() {
    if (getApps().length > 0) {
        return getApps()[0];
    }

    const serviceAccount: ServiceAccount = {
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    };

    return initializeApp({
        credential: cert(serviceAccount),
    });
}

const adminApp = getAdminApp();

export const adminMessaging = getMessaging(adminApp);
export const adminDb = getFirestore(adminApp);
