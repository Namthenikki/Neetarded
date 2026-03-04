// Firebase Messaging Service Worker
// This runs in the background and handles push notifications when the app is closed.
// IMPORTANT: Keep the Firebase SDK version here in sync with your package.json.

importScripts('https://www.gstatic.com/firebasejs/11.9.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.9.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyASNGQ_Ys68Cny7adSKFflEKM4qLa6XRU0",
  authDomain: "studio-3897093135-b2916.firebaseapp.com",
  projectId: "studio-3897093135-b2916",
  storageBucket: "studio-3897093135-b2916.appspot.com",
  messagingSenderId: "640362812798",
  appId: "1:640362812798:web:5b2dcd12d82f448195cf2f",
});

const messaging = firebase.messaging();

// Handle background messages (when the app is not in focus)
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message:', payload);

  const notificationTitle = payload.notification?.title || 'New Notification';
  const notificationOptions = {
    body: payload.notification?.body || 'You have a new update.',
    icon: '/web-app-manifest-192x192.png',
    badge: '/favicon-96x96.png',
    data: payload.data, // Pass data through so we can handle click
    vibrate: [200, 100, 200], // Vibrate pattern for mobile
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

// Handle notification click
self.addEventListener('notificationclick', (event) => {
  console.log('[firebase-messaging-sw.js] Notification click received.');
  event.notification.close();

  // Navigate to the quiz or dashboard when the notification is clicked
  const quizId = event.notification.data?.quizId;
  const urlToOpen = quizId ? `/quiz/${quizId}` : '/dashboard';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // If a window is already open, focus it
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(urlToOpen);
          return client.focus();
        }
      }
      // Otherwise, open a new window
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});
