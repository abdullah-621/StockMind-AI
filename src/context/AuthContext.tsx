import React, { createContext, useContext, useEffect, useState } from 'react';
import { apiFetch, getStoredToken, setStoredToken } from '../lib/api';
import type { UserRole } from '../engine/types';

export interface SessionUser {
  id: number;
  email: string;
  fullName: string;
  role: UserRole;
  permissions: string[];
  department?: string;
}

interface AuthContextValue {
  user: SessionUser | null;
  loading: boolean;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  login: (email: string, password: string) => Promise<void>;
  register: (payload: {
    fullName: string;
    email: string;
    password: string;
    roleName: UserRole;
    department: string;
  }) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('stockmind_theme');
    return saved === 'dark' ? 'dark' : 'light';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
    localStorage.setItem('stockmind_theme', theme);
  }, [theme]);

  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setLoading(false);
      return;
    }
    apiFetch<{ user: SessionUser }>('/api/auth/me')
      .then((res) => setUser(res.user))
      .catch(() => {
        setStoredToken(null);
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    const res = await apiFetch<{ token: string; user: SessionUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setStoredToken(res.token);
    setUser(res.user);
  };

  const register = async (payload: {
    fullName: string;
    email: string;
    password: string;
    roleName: UserRole;
    department: string;
  }) => {
    const res = await apiFetch<{ token: string; user: SessionUser }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setStoredToken(res.token);
    setUser(res.user);
  };

  const logout = () => {
    setStoredToken(null);
    setUser(null);
  };

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  return (
    <AuthContext.Provider value={{ user, loading, theme, toggleTheme, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
