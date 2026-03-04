import { getMessaging, getToken, onMessage, isSupported, type Messaging } from 'firebase/messaging';
import { app } from './config';

let messagingInstance: Messaging | null = null;

/**
 * Lazily initialize Firebase Messaging.
 * Returns null if the browser doesn't support it (e.g., Safari on some iOS versions).
 */
export const getMessagingInstance = async (): Promise<Messaging | null> => {
    if (messagingInstance) return messagingInstance;

    const supported = await isSupported();
    if (!supported) {
        console.warn('Firebase Messaging is not supported in this browser.');
        return null;
    }

    messagingInstance = getMessaging(app);
    return messagingInstance;
};

/**
 * Request notification permission, register the service worker,
 * and retrieve the FCM token for this device.
 * Returns the token string, or null if permission denied or unsupported.
 */
export const requestNotificationPermission = async (): Promise<string | null> => {
    try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            console.log('Notification permission denied.');
            return null;
        }

        const messaging = await getMessagingInstance();
        if (!messaging) return null;

        // Register the service worker explicitly
        const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
        console.log('Service Worker registered:', registration);

        const vapidKey = process.env.NEXT_PUBLIC_VAPID_KEY;
        if (!vapidKey) {
            console.error('VAPID key is not set. Add NEXT_PUBLIC_VAPID_KEY to your .env.local');
            return null;
        }

        const token = await getToken(messaging, {
            vapidKey,
            serviceWorkerRegistration: registration,
        });

        console.log('FCM Token obtained:', token);
        return token;
    } catch (error) {
        console.error('Error getting FCM token:', error);
        return null;
    }
};

/**
 * Listen for foreground messages (when the app is active/visible).
 * Returns a cleanup function.
 */
export const onForegroundMessage = (callback: (payload: any) => void) => {
    return getMessagingInstance().then((messaging) => {
        if (!messaging) return () => { };
        return onMessage(messaging, callback);
    });
};
