// src/pages/AdminPage.jsx
//
// Security Admin Dashboard
// – Login form (uses AuthContext)
// – Corridor management: block/unblock paths BETWEEN BUILDINGS
// – Raw segment table for detailed inspection
//
import { useEffect, useState, useCallback, useMemo } from 'react';
import { useAuth } from '../context/useAuth';
import { getAllRoadStatuses, updateRoadStatus } from '../services/adminService';
import campusGeoJsonRaw from '../data/map.geojson?raw';

// ═══════════════════════════════════════════════════════════════════════════
// GeoJSON graph helpers (mirrors MapPage logic exactly)
// ═══════════════════════════════════════════════════════════════════════════

function haversine([lat1, lng1], [lat2, lng2]) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function buildGraphFromGeoJson(featureCollection) {
  const lines = (featureCollection.features || []).filter(
    (f) => f?.geometry?.type === 'LineString',
  );
  const nodeIdByKey = new Map();
  const ROAD_NODES = {};
  const edgeSet = new Set();
  let nodeCount = 1;

  function getNodeId(lat, lng) {
    const key = `${lat.toFixed(6)},${lng.toFixed(6)}`;
    if (!nodeIdByKey.has(key)) {
      nodeIdByKey.set(key, `N${nodeCount++}`);
      ROAD_NODES[`N${nodeCount - 1}`] = [lat, lng];
    }
    return nodeIdByKey.get(key);
  }

  for (const lf of lines) {
    const coords = lf.geometry.coordinates || [];
    for (let i = 0; i < coords.length - 1; i++) {
      const a = getNodeId(coords[i][1], coords[i][0]);
      const b = getNodeId(coords[i + 1][1], coords[i + 1][0]);
      edgeSet.add([a, b].sort().join('|'));
    }
  }

  const entries = Object.entries(ROAD_NODES);
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      if (haversine(entries[i][1], entries[j][1]) <= 22) {
        edgeSet.add([entries[i][0], entries[j][0]].sort().join('|'));
      }
    }
  }

  const ROAD_EDGES = [...edgeSet].map((k) => k.split('|'));

  const adj = {};
  for (const id of Object.keys(ROAD_NODES)) adj[id] = [];
  for (const [a, b] of ROAD_EDGES) {
    const dist = haversine(ROAD_NODES[a], ROAD_NODES[b]);
    adj[a].push({ to: b, dist, edgeKey: [a, b].sort().join('|') });
    adj[b].push({ to: a, dist, edgeKey: [a, b].sort().join('|') });
  }

  return { ROAD_NODES, ROAD_EDGES, adj };
}

function buildBuildingsFromGeoJson(featureCollection, ROAD_NODES) {
  const points = (featureCollection.features || []).filter(
    (f) => f?.geometry?.type === 'Point',
  );
  return points.map((f, idx) => {
    const lng = f.geometry.coordinates[0];
    const lat = f.geometry.coordinates[1];
    const raw = f.properties?.name ?? f.properties?.['name '] ?? '';
    const name = String(raw).trim().replace(/\s+/g, ' ');

    let nearestId = null;
    let bestDist = Infinity;
    for (const [id, coord] of Object.entries(ROAD_NODES)) {
      const d = haversine([lat, lng], coord);
      if (d < bestDist) { bestDist = d; nearestId = id; }
    }

    return { id: idx, name: name || `Location ${idx + 1}`, lat, lng, snap: nearestId };
  });
}

function dijkstraEdges(adj, startId, endId) {
  const dist = {};
  const prev = {};
  const prevEdge = {};
  const visited = new Set();

  for (const k of Object.keys(adj)) { dist[k] = Infinity; prev[k] = null; prevEdge[k] = null; }
  if (!adj[startId] || !adj[endId]) return null;

  dist[startId] = 0;
  const pq = [[0, startId]];

  while (pq.length > 0) {
    pq.sort((a, b) => a[0] - b[0]);
    const [cost, u] = pq.shift();
    if (visited.has(u)) continue;
    visited.add(u);
    if (u === endId) break;
    for (const { to, dist: edgeDist, edgeKey } of (adj[u] || [])) {
      if (visited.has(to)) continue;
      const newDist = cost + edgeDist;
      if (newDist < dist[to]) {
        dist[to] = newDist;
        prev[to] = u;
        prevEdge[to] = edgeKey;
        pq.push([newDist, to]);
      }
    }
  }

  if (dist[endId] === Infinity) return null;

  const edges = [];
  let cur = endId;
  while (prev[cur]) { edges.unshift(prevEdge[cur]); cur = prev[cur]; }
  return edges;
}

const campusGeoJson = JSON.parse(campusGeoJsonRaw);
const { ROAD_NODES, adj: GRAPH } = buildGraphFromGeoJson(campusGeoJson);
const BUILDINGS = buildBuildingsFromGeoJson(campusGeoJson, ROAD_NODES);

// ═══════════════════════════════════════════════════════════════════════════
// Tiny UI helpers
// ═══════════════════════════════════════════════════════════════════════════

const CROWD_COLORS = {
  low:    { bg: 'bg-emerald-500/15', text: 'text-emerald-400', dot: 'bg-emerald-400', border: 'border-emerald-500/20' },
  medium: { bg: 'bg-amber-500/15',   text: 'text-amber-400',   dot: 'bg-amber-400',   border: 'border-amber-500/20'   },
  high:   { bg: 'bg-red-500/15',     text: 'text-red-400',     dot: 'bg-red-400',     border: 'border-red-500/20'     },
};

function CrowdBadge({ level }) {
  const c = CROWD_COLORS[level] || CROWD_COLORS.low;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${c.bg} ${c.text} ${c.border}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
      {level.charAt(0).toUpperCase() + level.slice(1)}
    </span>
  );
}

function StatusBadge({ blocked }) {
  return blocked
    ? <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/20 bg-red-500/15 px-2.5 py-0.5 text-xs font-semibold text-red-400">
        <span className="h-1.5 w-1.5 rounded-full bg-red-400" /> Blocked
      </span>
    : <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-400">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Open
      </span>;
}

function Spinner() {
  return (
    <svg className="h-5 w-5 animate-spin text-blue-400" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Login Form
// ═══════════════════════════════════════════════════════════════════════════

function LoginForm() {
  const { login, loading, error } = useAuth();
  const [form, setForm] = useState({ username: '', password: '' });
  const [showPass, setShowPass] = useState(false);

  const handleChange = (e) =>
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    await login(form.username.trim(), form.password);
  };

  return (
    <div className="relative min-h-[80vh] flex items-center justify-center px-4 overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      {/* bg orbs */}
      <div className="pointer-events-none absolute -top-32 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-blue-600/10 blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-64 w-64 rounded-full bg-indigo-600/10 blur-3xl" />

      <div className="relative w-full max-w-sm">
        {/* Logo */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-2xl shadow-blue-900/50 ring-1 ring-white/10 text-3xl">
            🛡️
          </div>
          <h1 className="text-2xl font-extrabold text-white">Security Login</h1>
          <p className="mt-1.5 text-sm text-slate-400">Campus Navigator Admin Portal</p>
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/5 p-7 shadow-2xl backdrop-blur-sm ring-1 ring-white/5">
          {error && (
            <div className="mb-5 flex items-center gap-2.5 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              <svg className="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="username" className="mb-1.5 block text-xs font-semibold uppercase tracking-widest text-slate-500">Username</label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </span>
                <input id="username" name="username" type="text" autoComplete="username" required
                  value={form.username} onChange={handleChange} placeholder="admin"
                  className="w-full rounded-xl border border-white/10 bg-white/5 pl-10 pr-4 py-3 text-sm text-white placeholder:text-slate-600 focus:border-blue-500/50 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all" />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="mb-1.5 block text-xs font-semibold uppercase tracking-widest text-slate-500">Password</label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </span>
                <input id="password" name="password" type={showPass ? 'text' : 'password'} autoComplete="current-password" required
                  value={form.password} onChange={handleChange} placeholder="••••••••"
                  className="w-full rounded-xl border border-white/10 bg-white/5 pl-10 pr-11 py-3 text-sm text-white placeholder:text-slate-600 focus:border-blue-500/50 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all" />
                <button type="button" tabIndex={-1} onClick={() => setShowPass(p => !p)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors">
                  {showPass
                    ? <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                    : <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                  }
                </button>
              </div>
            </div>

            <button type="submit" disabled={loading}
              className="mt-2 w-full rounded-2xl bg-gradient-to-r from-blue-500 to-indigo-600 px-4 py-3.5 text-sm font-bold text-white shadow-lg shadow-blue-900/40 transition-all hover:from-blue-400 hover:to-indigo-500 active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-50">
              {loading
                ? <span className="flex items-center justify-center gap-2"><Spinner /> Signing in…</span>
                : 'Sign In'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Corridor Block Modal
// ═══════════════════════════════════════════════════════════════════════════

function CorridorModal({ onClose, onSaved, existingCorridors }) {
  const [fromBuilding, setFromBuilding] = useState('');
  const [toBuilding,   setToBuilding]   = useState('');
  const [crowdLevel,   setCrowdLevel]   = useState('low');
  const [blocked,      setBlocked]      = useState(true);
  const [remarks,      setRemarks]      = useState('');
  const [saving,       setSaving]       = useState(false);
  const [err,          setErr]          = useState('');
  const [preview,      setPreview]      = useState(null);

  useEffect(() => {
    if (!fromBuilding || !toBuilding || fromBuilding === toBuilding) { setPreview(null); return; }
    const from = BUILDINGS.find((b) => b.name === fromBuilding);
    const to   = BUILDINGS.find((b) => b.name === toBuilding);
    if (!from || !to) { setPreview(null); return; }
    const edges = dijkstraEdges(GRAPH, from.snap, to.snap);
    if (!edges) {
      setPreview({ edgeKeys: [], distM: 0, noPath: true });
    } else {
      const distM = edges.reduce((sum, ek) => {
        const [a, b] = ek.split('|');
        return sum + (ROAD_NODES[a] && ROAD_NODES[b] ? haversine(ROAD_NODES[a], ROAD_NODES[b]) : 0);
      }, 0);
      setPreview({ edgeKeys: edges, distM: Math.round(distM), noPath: false });
    }
  }, [fromBuilding, toBuilding]);

  const handleSave = async () => {
    if (!preview || preview.noPath || preview.edgeKeys.length === 0) return;
    setSaving(true); setErr('');
    try {
      await Promise.all(preview.edgeKeys.map((ek) => updateRoadStatus(ek, { blocked, crowdLevel, remarks })));
      onSaved();
    } catch (e) {
      setErr(e.response?.data?.error || 'Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-slate-900 p-6 shadow-2xl ring-1 ring-white/5">

        {/* Header */}
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">Block / Update Corridor</h2>
            <p className="mt-0.5 text-sm text-slate-400">Select two buildings — all road segments between them will be updated.</p>
          </div>
          <button onClick={onClose} className="rounded-xl p-1.5 text-slate-500 hover:bg-white/10 hover:text-white transition-colors">
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        {err && (
          <div className="mb-4 flex items-center gap-2.5 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            <svg className="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
            {err}
          </div>
        )}

        <div className="space-y-4">
          {/* Building selectors */}
          <div className="grid grid-cols-2 gap-3">
            {[['From Building', fromBuilding, setFromBuilding, toBuilding], ['To Building', toBuilding, setToBuilding, fromBuilding]].map(([label, val, setter, disabledVal]) => (
              <div key={label}>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-widest text-slate-500">{label}</label>
                <select value={val} onChange={(e) => setter(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white focus:border-blue-500/50 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all">
                  <option value="">Select…</option>
                  {BUILDINGS.map((b) => (
                    <option key={b.id} value={b.name} disabled={b.name === disabledVal}>{b.name}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          {/* Path preview */}
          {preview && (
            <div className={`rounded-2xl border p-3.5 text-sm ${preview.noPath ? 'border-amber-500/20 bg-amber-500/10' : 'border-blue-500/20 bg-blue-500/10'}`}>
              {preview.noPath
                ? <p className="text-amber-400">⚠️ No road path found between these buildings.</p>
                : <div className="flex items-center gap-5 text-blue-300">
                    <span>🛣️ <strong className="text-white">{preview.edgeKeys.length}</strong> road segments</span>
                    <span>📏 <strong className="text-white">{preview.distM}m</strong> corridor length</span>
                  </div>
              }
            </div>
          )}

          {/* Blocked toggle */}
          <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 p-4">
            <div>
              <p className="text-sm font-semibold text-white">Block this corridor</p>
              <p className="text-xs text-slate-500">Removes it from all route calculations</p>
            </div>
            <button type="button" onClick={() => setBlocked((b) => !b)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:ring-offset-2 focus:ring-offset-slate-900 ${blocked ? 'bg-red-500' : 'bg-slate-700'}`}>
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${blocked ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>

          {/* Crowd density */}
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-widest text-slate-500">Crowd Density</label>
            <div className="flex gap-2">
              {['low', 'medium', 'high'].map((level) => {
                const c = CROWD_COLORS[level];
                const selected = crowdLevel === level;
                return (
                  <button key={level} type="button" onClick={() => setCrowdLevel(level)}
                    className={`flex-1 rounded-xl border-2 py-2.5 text-sm font-semibold transition-all ${
                      selected ? `${c.border} ${c.bg} ${c.text}` : 'border-white/10 text-slate-500 hover:border-white/20 hover:text-slate-300'
                    }`}>
                    {level.charAt(0).toUpperCase() + level.slice(1)}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Remarks */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-widest text-slate-500">
              Remarks <span className="font-normal normal-case text-slate-600">(optional)</span>
            </label>
            <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)}
              placeholder="e.g. VIP procession until 6 PM, construction work"
              rows={2} maxLength={500}
              className="w-full resize-none rounded-xl border border-white/10 bg-white/5 px-3.5 py-3 text-sm text-white placeholder:text-slate-600 focus:border-blue-500/50 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all" />
          </div>
        </div>

        {/* Actions */}
        <div className="mt-6 flex gap-3">
          <button onClick={onClose}
            className="flex-1 rounded-2xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-slate-300 hover:bg-white/5 transition-colors">
            Cancel
          </button>
          <button onClick={handleSave}
            disabled={saving || !preview || preview.noPath || preview.edgeKeys.length === 0}
            className="flex-1 rounded-2xl bg-gradient-to-r from-blue-500 to-indigo-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-900/40 transition-all hover:from-blue-400 hover:to-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[.98]">
            {saving
              ? <span className="flex items-center justify-center gap-2"><Spinner /> Saving…</span>
              : `Apply to ${preview?.edgeKeys.length ?? 0} segments`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Single-segment edit modal
// ═══════════════════════════════════════════════════════════════════════════

function EditModal({ segment, onClose, onSaved }) {
  const [form, setForm] = useState({
    blocked:    segment.blocked,
    crowdLevel: segment.crowdLevel,
    remarks:    segment.remarks || '',
  });
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState('');

  const handleSave = async () => {
    setSaving(true); setErr('');
    try {
      await updateRoadStatus(segment.edgeKey, form);
      onSaved();
    } catch (e) {
      setErr(e.response?.data?.error || 'Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-900 p-6 shadow-2xl ring-1 ring-white/5">
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">Edit Road Segment</h2>
            <p className="mt-0.5 font-mono text-xs text-slate-500">{segment.fromNode} → {segment.toNode}</p>
          </div>
          <button onClick={onClose} className="rounded-xl p-1.5 text-slate-500 hover:bg-white/10 hover:text-white transition-colors">
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        {err && (
          <div className="mb-4 flex items-center gap-2.5 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            <svg className="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
            {err}
          </div>
        )}

        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 p-4">
            <div>
              <p className="text-sm font-semibold text-white">Road Blocked</p>
              <p className="text-xs text-slate-500">Prevents this segment from routing</p>
            </div>
            <button type="button" onClick={() => setForm((p) => ({ ...p, blocked: !p.blocked }))}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:ring-offset-2 focus:ring-offset-slate-900 ${form.blocked ? 'bg-red-500' : 'bg-slate-700'}`}>
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${form.blocked ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>

          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-widest text-slate-500">Crowd Density</label>
            <div className="flex gap-2">
              {['low', 'medium', 'high'].map((level) => {
                const c = CROWD_COLORS[level];
                const selected = form.crowdLevel === level;
                return (
                  <button key={level} type="button" onClick={() => setForm((p) => ({ ...p, crowdLevel: level }))}
                    className={`flex-1 rounded-xl border-2 py-2.5 text-sm font-semibold transition-all ${
                      selected ? `${c.border} ${c.bg} ${c.text}` : 'border-white/10 text-slate-500 hover:border-white/20 hover:text-slate-300'
                    }`}>
                    {level.charAt(0).toUpperCase() + level.slice(1)}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-widest text-slate-500">
              Remarks <span className="font-normal normal-case text-slate-600">(optional)</span>
            </label>
            <textarea value={form.remarks} onChange={(e) => setForm((p) => ({ ...p, remarks: e.target.value }))}
              rows={3} maxLength={500}
              className="w-full resize-none rounded-xl border border-white/10 bg-white/5 px-3.5 py-3 text-sm text-white placeholder:text-slate-600 focus:border-blue-500/50 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all" />
            <p className="mt-1 text-right text-xs text-slate-600">{form.remarks.length}/500</p>
          </div>
        </div>

        <div className="mt-6 flex gap-3">
          <button onClick={onClose}
            className="flex-1 rounded-2xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-slate-300 hover:bg-white/5 transition-colors">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 rounded-2xl bg-gradient-to-r from-blue-500 to-indigo-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-900/40 transition-all hover:from-blue-400 hover:to-indigo-500 disabled:opacity-50 active:scale-[.98]">
            {saving
              ? <span className="flex items-center justify-center gap-2"><Spinner /> Saving…</span>
              : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Dashboard
// ═══════════════════════════════════════════════════════════════════════════

function Dashboard() {
  const { admin, logout } = useAuth();
  const [segments,          setSegments]          = useState([]);
  const [loading,           setLoading]           = useState(true);
  const [error,             setError]             = useState('');
  const [search,            setSearch]            = useState('');
  const [filter,            setFilter]            = useState('all');
  const [editing,           setEditing]           = useState(null);
  const [showCorridorModal, setShowCorridorModal] = useState(false);
  const [activeTab,         setActiveTab]         = useState('corridors');

  const totalBlocked   = segments.filter((s) => s.blocked).length;
  const totalHighCrowd = segments.filter((s) => s.crowdLevel === 'high').length;

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const data = await getAllRoadStatuses();
      setSegments(data.segments || []);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load road statuses.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSaved = () => { setEditing(null); setShowCorridorModal(false); load(); };

  const corridorSummary = useMemo(() => {
    const blockedEdgeSet = new Set(segments.filter((s) => s.blocked).map((s) => s.edgeKey));
    if (blockedEdgeSet.size === 0) return [];
    const corridors = [];
    for (let i = 0; i < BUILDINGS.length; i++) {
      for (let j = i + 1; j < BUILDINGS.length; j++) {
        const from = BUILDINGS[i]; const to = BUILDINGS[j];
        const edges = dijkstraEdges(GRAPH, from.snap, to.snap);
        if (!edges || edges.length === 0) continue;
        const blockedCount = edges.filter((ek) => blockedEdgeSet.has(ek)).length;
        if (blockedCount > 0 && blockedCount === edges.length) {
          corridors.push({ from: from.name, to: to.name, edgeCount: edges.length, blockedCount });
        }
      }
    }
    return corridors.slice(0, 20);
  }, [segments]);

  const visible = segments.filter((s) => {
    const matchSearch = search === '' ||
      s.fromNode.toLowerCase().includes(search.toLowerCase()) ||
      s.toNode.toLowerCase().includes(search.toLowerCase()) ||
      s.edgeKey.toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === 'all' || (filter === 'blocked' && s.blocked) || (filter === 'open' && !s.blocked);
    return matchSearch && matchFilter;
  });

  const statCards = [
    { label: 'Total Segments', value: segments.length,               icon: '🛣️', color: 'border-white/10 bg-white/5' },
    { label: 'Blocked',        value: totalBlocked,                   icon: '🚫', color: 'border-red-500/20 bg-red-500/10' },
    { label: 'High Crowd',     value: totalHighCrowd,                 icon: '🔴', color: 'border-amber-500/20 bg-amber-500/10' },
    { label: 'Open Paths',     value: segments.length - totalBlocked, icon: '✅', color: 'border-emerald-500/20 bg-emerald-500/10' },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 px-4 py-6 sm:px-6 lg:px-8">
      {/* bg decoration */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-32 -left-32 h-96 w-96 rounded-full bg-blue-600/8 blur-3xl" />
        <div className="absolute top-1/2 -right-32 h-80 w-80 rounded-full bg-indigo-600/8 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-6xl space-y-6">

        {/* Top bar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold text-white">Security Dashboard</h1>
            <p className="mt-0.5 text-sm text-slate-400">
              Logged in as <span className="font-semibold text-slate-200">{admin?.username}</span>
              {' '}· <span className="capitalize">{admin?.role}</span>
            </p>
          </div>
          <button onClick={logout}
            className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-300 transition-all hover:bg-white/10 hover:text-white active:scale-[.98]">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Sign Out
          </button>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {statCards.map((s) => (
            <div key={s.label} className={`rounded-2xl border ${s.color} p-4 backdrop-blur-sm ring-1 ring-white/5`}>
              <div className="text-2xl">{s.icon}</div>
              <div className="mt-2 text-3xl font-extrabold text-white">{s.value}</div>
              <div className="mt-0.5 text-xs text-slate-500">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Tabs + actions */}
        <div className="flex flex-wrap items-center gap-3 border-b border-white/10 pb-0">
          <div className="flex items-center gap-1">
            {[['corridors', '🏢 Corridors'], ['segments', '🔗 Raw Segments']].map(([tab, label]) => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={`rounded-t-xl px-4 py-2.5 text-sm font-semibold transition-colors border-b-2 -mb-px ${
                  activeTab === tab
                    ? 'border-blue-500 text-white bg-blue-500/10'
                    : 'border-transparent text-slate-500 hover:text-slate-300'
                }`}>
                {label}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => setShowCorridorModal(true)}
              className="flex items-center gap-2 rounded-2xl bg-gradient-to-r from-blue-500 to-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-blue-900/30 transition-all hover:from-blue-400 hover:to-indigo-500 active:scale-[.98]">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Block Corridor
            </button>
            <button onClick={load} disabled={loading}
              className="flex items-center gap-1.5 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-slate-300 hover:bg-white/10 hover:text-white disabled:opacity-50 transition-all">
              <svg className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Refresh
            </button>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2.5 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            <svg className="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
            {error}
          </div>
        )}

        {/* ── CORRIDORS TAB ── */}
        {activeTab === 'corridors' && (
          <div className="space-y-3">
            <p className="text-sm text-slate-500">
              Showing fully-blocked building-to-building corridors. Use <strong className="text-slate-300">Block Corridor</strong> above to add one.
            </p>

            {loading && (
              <div className="flex items-center justify-center gap-3 py-14 text-slate-500">
                <Spinner /> Loading corridors…
              </div>
            )}

            {!loading && corridorSummary.length === 0 && (
              <div className="rounded-2xl border border-dashed border-white/10 py-14 text-center">
                <div className="text-4xl mb-3">✅</div>
                <p className="text-slate-400 text-sm font-medium">No corridors are currently fully blocked.</p>
                <p className="text-slate-600 text-xs mt-1">All campus routes are open.</p>
              </div>
            )}

            {!loading && corridorSummary.map((c, i) => (
              <div key={i} className="flex items-center gap-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-5 py-4 backdrop-blur-sm ring-1 ring-red-500/5">
                <span className="text-2xl">🚫</span>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-white text-sm truncate">
                    {c.from} <span className="text-slate-500 font-normal">→</span> {c.to}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">{c.edgeCount} road segments blocked</div>
                </div>
                <span className="shrink-0 rounded-full border border-red-500/20 bg-red-500/15 px-3 py-1 text-xs font-semibold text-red-400">Blocked</span>
              </div>
            ))}
          </div>
        )}

        {/* ── RAW SEGMENTS TAB ── */}
        {activeTab === 'segments' && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[200px]">
                <svg className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input type="search" placeholder="Search node IDs or edge keys…" value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-white/5 py-2.5 pl-10 pr-4 text-sm text-white placeholder:text-slate-600 focus:border-blue-500/50 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all" />
              </div>
              <div className="flex rounded-xl border border-white/10 bg-white/5 p-1">
                {[['all','All'],['blocked','Blocked'],['open','Open']].map(([val, label]) => (
                  <button key={val} onClick={() => setFilter(val)}
                    className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                      filter === val ? 'bg-white/10 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'
                    }`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm ring-1 ring-white/5">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-white/5 text-sm">
                  <thead>
                    <tr className="bg-white/5">
                      {['From Node', 'To Node', 'Distance', 'Status', 'Crowd Level', 'Remarks', 'Last Updated', 'Actions'].map((h) => (
                        <th key={h} className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-widest text-slate-500">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {loading && (
                      <tr><td colSpan={8} className="px-4 py-14 text-center">
                        <div className="flex items-center justify-center gap-3 text-slate-500">
                          <Spinner /> Loading road segments…
                        </div>
                      </td></tr>
                    )}
                    {!loading && visible.length === 0 && (
                      <tr><td colSpan={8} className="px-4 py-14 text-center text-slate-500">No segments match your search.</td></tr>
                    )}
                    {!loading && visible.map((seg) => (
                      <tr key={seg.edgeKey} className="hover:bg-white/5 transition-colors group">
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs font-semibold text-slate-300">{seg.fromNode}</td>
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs font-semibold text-slate-300">{seg.toNode}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-400">{seg.distance} m</td>
                        <td className="whitespace-nowrap px-4 py-3"><StatusBadge blocked={seg.blocked} /></td>
                        <td className="whitespace-nowrap px-4 py-3"><CrowdBadge level={seg.crowdLevel} /></td>
                        <td className="max-w-[160px] truncate px-4 py-3 text-slate-500" title={seg.remarks}>
                          {seg.remarks || <span className="text-slate-700">—</span>}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-600">
                          {seg.updatedAt ? new Date(seg.updatedAt).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <button onClick={() => setEditing(seg)}
                            className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300 transition-all hover:border-blue-500/30 hover:bg-blue-500/10 hover:text-blue-400">
                            Edit
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!loading && (
                <div className="border-t border-white/5 px-4 py-2.5 text-xs text-slate-600">
                  Showing {visible.length} of {segments.length} segments
                </div>
              )}
            </div>
          </>
        )}

      </div>

      {editing && <EditModal segment={editing} onClose={() => setEditing(null)} onSaved={handleSaved} />}
      {showCorridorModal && <CorridorModal onClose={() => setShowCorridorModal(false)} onSaved={handleSaved} existingCorridors={corridorSummary} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Page root
// ═══════════════════════════════════════════════════════════════════════════

function AdminPage() {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <Dashboard /> : <LoginForm />;
}

export default AdminPage;