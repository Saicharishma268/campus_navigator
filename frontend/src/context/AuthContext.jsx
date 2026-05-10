// src/context/AuthContext.jsx
import { useState, useCallback } from 'react';
import { loginAdmin } from '../services/adminService';
import { AuthContext } from './auth-context';

// ── Provider ─────────────────────────────────────────────────────────────
export function AuthProvider({ children }) {
  // Rehydrate from localStorage on first load
  const [token, setToken] = useState(() =>
    localStorage.getItem('campus_admin_token') || null,
  );
  const [admin, setAdmin] = useState(() => {
    try {
      const raw = localStorage.getItem('campus_admin_user');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  // ── Login ───────────────────────────────────────────────────────────────
  const login = useCallback(async (username, password) => {
    setLoading(true);
    setError('');
    try {
      const data = await loginAdmin(username, password);
      localStorage.setItem('campus_admin_token', data.token);
      localStorage.setItem('campus_admin_user', JSON.stringify(data.admin));
      setToken(data.token);
      setAdmin(data.admin);
      return true;
    } catch (err) {
      const msg = err.response?.data?.error || 'Login failed. Please try again.';
      setError(msg);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Logout ──────────────────────────────────────────────────────────────
  const logout = useCallback(() => {
    localStorage.removeItem('campus_admin_token');
    localStorage.removeItem('campus_admin_user');
    setToken(null);
    setAdmin(null);
    setError('');
  }, []);

  const isAuthenticated = !!token;

  return (
    <AuthContext.Provider value={{ token, admin, isAuthenticated, loading, error, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}