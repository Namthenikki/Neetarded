"use client";

import { createContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { useRouter } from 'next/navigation';

export interface AppUser {
  studentId: string;
  name: string;
  role: 'student' | 'admin';
}

interface AuthContextType {
  user: AppUser | null;
  loading: boolean;
  logout: () => void;
  login: (user: AppUser) => void;
}

export const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  logout: () => {},
  login: () => {},
});

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    try {
        const storedId = localStorage.getItem('neetarded_id');
        const storedName = localStorage.getItem('neetarded_name');
        const storedRole = localStorage.getItem('neetarded_role');

        if (storedId && storedName) {
            setUser({
                studentId: storedId,
                name: storedName,
                role: storedRole === 'admin' ? 'admin' : 'student',
            });
        }
    } catch (e) {
        console.error("Could not read from localStorage", e);
    } finally {
        setLoading(false);
    }
  }, []);

  const login = useCallback((newUser: AppUser) => {
    localStorage.setItem('neetarded_id', newUser.studentId);
    localStorage.setItem('neetarded_name', newUser.name);
    localStorage.setItem('neetarded_role', newUser.role);
    setUser(newUser);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('neetarded_id');
    localStorage.removeItem('neetarded_name');
    localStorage.removeItem('neetarded_role');
    setUser(null);
    router.push('/login');
  }, [router]);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
