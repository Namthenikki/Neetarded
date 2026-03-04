"use client";

import { useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { requestNotificationPermission, onForegroundMessage } from '@/lib/firebase/messaging';
import { doc, setDoc, arrayUnion } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';

/**
 * Hook that handles push notification setup for students.
 * - Requests notification permission on mount.
 * - Saves the FCM token to the user's Firestore doc.
 * - Listens for foreground messages and shows a toast.
 */
export function usePushNotifications() {
    const { user } = useAuth();
    const { toast } = useToast();
    const initialized = useRef(false);

    const setupNotifications = useCallback(async () => {
        if (!user || user.role === 'admin') return; // Only for students
        if (initialized.current) return;
        initialized.current = true;

        try {
            const token = await requestNotificationPermission();
            if (!token) {
                console.log('Push notifications: No token received (denied or unsupported).');
                return;
            }

            // Save token to Firestore under the user's document.
            // Using arrayUnion so a user can have multiple devices.
            const userDocRef = doc(db, 'users', user.studentId);
            await setDoc(userDocRef, {
                fcmTokens: arrayUnion(token),
            }, { merge: true });

            console.log('FCM token saved to Firestore for user:', user.studentId);
        } catch (error) {
            console.error('Failed to set up push notifications:', error);
        }
    }, [user]);

    // Setup on mount
    useEffect(() => {
        setupNotifications();
    }, [setupNotifications]);

    // Listen for foreground messages
    useEffect(() => {
        let unsubscribe: (() => void) | undefined;

        onForegroundMessage((payload) => {
            console.log('Foreground message received:', payload);
            toast({
                title: payload.notification?.title || '📢 New Notification',
                description: payload.notification?.body || 'You have a new update!',
            });
        }).then((unsub) => {
            if (typeof unsub === 'function') {
                unsubscribe = unsub;
            }
        });

        return () => {
            if (unsubscribe) unsubscribe();
        };
    }, [toast]);
}
