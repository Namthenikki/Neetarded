"use client";

import { createContext, useState, useEffect, ReactNode } from 'react';
import { onAuthStateChanged, User as FirebaseAuthUser } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase/config';

export interface AppUser {
  uid: string;
  name: string;
  email: string;
  uniqueId: string;
}

interface AuthContextType {
  user: AppUser | null;
  firebaseUser: FirebaseAuthUser | null;
  loading: boolean;
}

export const AuthContext = createContext<AuthContextType>({
  user: null,
  firebaseUser: null,
  loading: true,
});

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseAuthUser | null>(null);
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (authUser) => {
      setFirebaseUser(authUser);
      if (!authUser) {
        setUser(null);
        setLoading(false);
      }
    });

    return () => unsubscribeAuth();
  }, []);

  useEffect(() => {
    if (firebaseUser) {
      const userDocRef = doc(db, 'users', firebaseUser.uid);
      const unsubscribeSnapshot = onSnapshot(userDocRef, (docSnap) => {
        if (docSnap.exists()) {
          setUser(docSnap.data() as AppUser);
        } else {
          setUser(null);
        }
        setLoading(false);
      });
      return () => unsubscribeSnapshot();
    }
  }, [firebaseUser]);

  return (
    <AuthContext.Provider value={{ user, firebaseUser, loading }}>
      {children}
    </AuthContext.Provider>
  );
};
