"use client";

import { createContext, ReactNode } from 'react';

export interface AppUser {
  uid: string;
  name: string;
  email: string;
  uniqueId: string;
}

interface AuthContextType {
  user: AppUser | null;
  loading: boolean;
}

const mockUser: AppUser = {
  uid: 'mock-user-uid-12345',
  name: 'Neetard User',
  email: 'neetard.user@example.com',
  uniqueId: 'NTD123',
};


export const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
});

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  return (
    <AuthContext.Provider value={{ user: mockUser, loading: false }}>
      {children}
    </AuthContext.Provider>
  );
};
