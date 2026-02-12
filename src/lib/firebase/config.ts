import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyASNGQ_Ys68Cny7adSKFflEKM4qLa6XRU0",
  authDomain: "studio-3897093135-b2916.firebaseapp.com",
  projectId: "studio-3897093135-b2916",
  storageBucket: "studio-3897093135-b2916.appspot.com",
  messagingSenderId: "640362812798",
  appId: "1:640362812798:web:5b2dcd12d82f448195cf2f",
};

// Initialize Firebase
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);
const db = getFirestore(app);

export { app, auth, db };
