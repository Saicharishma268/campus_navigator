// src/services/adminService.js
import api from './api';

// ── Auth ─────────────────────────────────────────────────────────────────

export async function loginAdmin(username, password) {
  const res = await api.post('/admin/login', { username, password });
  return res.data; // { token, admin: { username, role } }
}

export async function getMe() {
  const res = await api.get('/admin/me');
  return res.data;
}

// ── Road Status ──────────────────────────────────────────────────────────

// Get all road segments merged with their current status (public endpoint — no auth)
export async function getAllRoadStatuses() {
  const res = await api.get('/routes/road-status');
  return res.data; // { total, segments: [...] }
}

// Get status for a single segment
export async function getRoadStatus(edgeKey) {
  const encoded = encodeURIComponent(edgeKey);
  const res = await api.get(`/admin/road-status/${encoded}`);
  return res.data;
}

// Create a new status entry
export async function createRoadStatus(payload) {
  // payload: { edgeKey, blocked, crowdLevel, remarks }
  const res = await api.post('/admin/road-status', payload);
  return res.data;
}

// Update (upsert) status for a segment — main function used by AdminPage
export async function updateRoadStatus(edgeKey, payload) {
  // payload: { blocked?, crowdLevel?, remarks? }
  const encoded = encodeURIComponent(edgeKey);
  const res = await api.put(`/admin/road-status/${encoded}`, payload);
  return res.data;
}