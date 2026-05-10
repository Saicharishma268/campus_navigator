// src/services/api.js
//
// Central axios instance — all API calls go through here.
// Base URL is read from Vite env so you can switch between
// local and production without touching any other file.
//
import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api',
  headers: { 'Content-Type': 'application/json' },
  timeout: 10000,
});

// ── Request interceptor ──────────────────────────────────────────────────
// Automatically attach JWT token to every request if present
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('campus_admin_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ── Response interceptor ─────────────────────────────────────────────────
// Auto-logout if token is expired or invalid
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('campus_admin_token');
      localStorage.removeItem('campus_admin_user');
      // Reload to reset app state
      if (window.location.pathname.includes('admin')) {
        window.location.href = '/';
      }
    }
    return Promise.reject(error);
  },
);

export default api;