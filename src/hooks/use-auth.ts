
"use client";
import { useContext } from 'react';
import { AuthContext, AppUser } from '@/contexts/auth-context';

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export type { AppUser };
