import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api.js';

interface AuthState {
  email: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<{ success: boolean; email: string }>('/admin/auth/me')
      .then((res) => setEmail(res.email))
      .catch(() => setEmail(null))
      .finally(() => setLoading(false));
  }, []);

  const login = async (loginEmail: string, password: string) => {
    const res = await api.post<{ success: boolean; email: string }>('/admin/auth/login', {
      email: loginEmail,
      password,
    });
    setEmail(res.email);
  };

  const logout = async () => {
    await api.post('/admin/auth/logout');
    setEmail(null);
  };

  return <AuthContext.Provider value={{ email, loading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
