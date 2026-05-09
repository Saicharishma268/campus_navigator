import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import campusGeoJsonRaw from '../data/map.geojson?raw';
// ═══════════════════════════════════════════════════════════════════════════════
// ROAD NETWORK — explicitly defined from the actual campus map
// ═══════════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════════
// DATA FROM GEOJSON (AUTO-CLEAN + AUTO-GRAPH)
// ═══════════════════════════════════════════════════════════════════════════════

function toLatLng(coord) {
  // GeoJSON is [lng, lat]
  return [coord[1], coord[0]];
}

function cleanName(properties = {}, fallback) {
  const raw = properties.name ?? properties['name '] ?? '';
  const name = String(raw).trim().replace(/\s+/g, ' ');
  return name || fallback;
}

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

function buildRoadGraphFromGeoJson(featureCollection) {
  const lineFeatures = (featureCollection.features || []).filter(
    (f) => f?.geometry?.type === 'LineString',
  );

  const nodeIdByKey = new Map();
  const ROAD_NODES = {};
  const edgeSet = new Set();

  let nodeCount = 1;

  function getNodeId(lat, lng) {
    const key = `${lat.toFixed(6)},${lng.toFixed(6)}`;
    if (!nodeIdByKey.has(key)) {
      const id = `N${nodeCount++}`;
      nodeIdByKey.set(key, id);
      ROAD_NODES[id] = [lat, lng];
    }
    return nodeIdByKey.get(key);
  }

  for (const lf of lineFeatures) {
    const coords = lf.geometry.coordinates || [];
    for (let i = 0; i < coords.length; i++) {
      const [lat, lng] = toLatLng(coords[i]);
      const a = getNodeId(lat, lng);

      if (i < coords.length - 1) {
        const [nextLat, nextLng] = toLatLng(coords[i + 1]);
        const b = getNodeId(nextLat, nextLng);
        const edgeKey = [a, b].sort().join('|');
        edgeSet.add(edgeKey);
      }
    }
  }

  const ROAD_EDGES = [...edgeSet].map((edgeKey) => edgeKey.split('|'));

  // Many traced road lines don't share exact same coordinates at junctions.
  // Connect very close road nodes so shortest-path can traverse the full network.
  const mergedEdges = connectNearbyRoadNodes(ROAD_NODES, ROAD_EDGES, 22);
  return { ROAD_NODES, ROAD_EDGES: mergedEdges };
}

function connectNearbyRoadNodes(roadNodes, roadEdges, thresholdMeters = 18) {
  const edgeSet = new Set(roadEdges.map(([a, b]) => [a, b].sort().join('|')));
  const entries = Object.entries(roadNodes);

  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const [idA, coordA] = entries[i];
      const [idB, coordB] = entries[j];
      const d = haversine(coordA, coordB);

      if (d <= thresholdMeters) {
        edgeSet.add([idA, idB].sort().join('|'));
      }
    }
  }

  return [...edgeSet].map((edgeKey) => edgeKey.split('|'));
}

function findNearestRoadNode([lat, lng], ROAD_NODES) {
  let nearestId = null;
  let bestDist = Infinity;

  for (const [nodeId, nodeCoord] of Object.entries(ROAD_NODES)) {
    const d = haversine([lat, lng], nodeCoord);
    if (d < bestDist) {
      bestDist = d;
      nearestId = nodeId;
    }
  }

  return nearestId;
}

function buildBuildingsFromGeoJson(featureCollection, ROAD_NODES) {
  const pointFeatures = (featureCollection.features || []).filter(
    (f) => f?.geometry?.type === 'Point',
  );

  return pointFeatures.map((f, idx) => {
    const [lat, lng] = toLatLng(f.geometry.coordinates);
    const fallbackName = `Location ${idx + 1}`;
    const name = cleanName(f.properties, fallbackName);

    return {
      id: idx, // clean unique ID (ignores duplicated geojson ids)
      name,
      lat,
      lng,
      snap: findNearestRoadNode([lat, lng], ROAD_NODES),
    };
  });
}

const campusGeoJson = JSON.parse(campusGeoJsonRaw);
const { ROAD_NODES, ROAD_EDGES } = buildRoadGraphFromGeoJson(campusGeoJson);
const BUILDINGS = buildBuildingsFromGeoJson(campusGeoJson, ROAD_NODES);
// ═══════════════════════════════════════════════════════════════════════════════
// CATEGORY CONFIG
// ═══════════════════════════════════════════════════════════════════════════════
const CATEGORIES = {
  academic:  { label: 'Academic',  color: '#3b82f6', icon: '🎓', keywords: ['bhavan', 'college', 'hub', 'polytechnic', 'business', 'school'] },
  hostel:    { label: 'Hostel',    color: '#f59e0b', icon: '🏠', keywords: ['hostel', 'quarters'] },
  worship:   { label: 'Worship',   color: '#8b5cf6', icon: '🙏', keywords: ['temple', 'mosque', 'church', 'sai baba'] },
  food:      { label: 'Food',      color: '#ef4444', icon: '🍽️', keywords: ['canteen'] },
  landmark:  { label: 'Landmark',  color: '#10b981', icon: '📍', keywords: ['emblem', 'flag', 'tree', 'model', 'gate', 'ground', 'garden', 'gallery', 'atm', 'bus'] },
};

function getCategory(name) {
  const lower = (name || '').toLowerCase();
  for (const [key, cat] of Object.entries(CATEGORIES)) {
    if (cat.keywords.some(k => lower.includes(k))) return key;
  }
  return 'academic';
}

const buildingsWithCategory = BUILDINGS.map(b => ({ ...b, category: getCategory(b.name) }));

// ═══════════════════════════════════════════════════════════════════════════════
// GRAPH CONSTRUCTION
// ═══════════════════════════════════════════════════════════════════════════════

function buildGraph() {
  const adj = {};
  for (const id of Object.keys(ROAD_NODES)) adj[id] = [];
  for (const [a, b] of ROAD_EDGES) {
    const dist = haversine(ROAD_NODES[a], ROAD_NODES[b]);
    adj[a].push({ to: b, dist });
    adj[b].push({ to: a, dist });
  }
  for (const bld of buildingsWithCategory) {
    const nodeId = `B_${bld.id}`;
    adj[nodeId] = [];
    const snapCoord = ROAD_NODES[bld.snap];
    const bldCoord = [bld.lat, bld.lng];
    const dist = haversine(bldCoord, snapCoord);
    adj[nodeId].push({ to: bld.snap, dist });
    adj[bld.snap].push({ to: nodeId, dist });
  }
  return adj;
}

const graph = buildGraph();

// ═══════════════════════════════════════════════════════════════════════════════
// DIJKSTRA
// ═══════════════════════════════════════════════════════════════════════════════
function dijkstraFull(startId, endId, blockedEdges = new Set(), blockedNodes = new Set()) {
  const dist = {};
  const prev = {};
  const visited = new Set();
  for (const k of Object.keys(graph)) { dist[k] = Infinity; prev[k] = null; }
  dist[startId] = 0;
  const pq = [[0, startId]];

  while (pq.length > 0) {
    pq.sort((a, b) => a[0] - b[0]);
    const [cost, u] = pq.shift();
    if (visited.has(u)) continue;
    visited.add(u);
    if (u === endId) break;
    for (const { to, dist: edgeDist } of (graph[u] || [])) {
      if (visited.has(to)) continue;
      if (blockedNodes.has(to) && to !== endId) continue;
      const edgeKey = [u, to].sort().join('|');
      if (blockedEdges.has(edgeKey)) continue;
      const newDist = cost + edgeDist;
      if (newDist < dist[to]) {
        dist[to] = newDist;
        prev[to] = u;
        pq.push([newDist, to]);
      }
    }
  }

  if (dist[endId] === Infinity) return null;
  const nodeIds = [];
  let cur = endId;
  while (cur) { nodeIds.unshift(cur); cur = prev[cur]; }

  const coords = nodeIds.map(id => {
    if (id.startsWith('B_')) {
      const bld = buildingsWithCategory.find(b => b.id === parseInt(id.replace('B_', '')));
      return bld ? [bld.lat, bld.lng] : null;
    }
    return ROAD_NODES[id];
  }).filter(Boolean);

  return { nodeIds, path: coords, totalDist: dist[endId] };
}

// ═══════════════════════════════════════════════════════════════════════════════
// YEN'S K-SHORTEST PATHS
// ═══════════════════════════════════════════════════════════════════════════════
function yenKShortestPaths(startId, endId, K = 3) {
  const shortest = dijkstraFull(startId, endId);
  if (!shortest) return [];
  const kPaths = [shortest];
  const candidates = [];

  for (let k = 1; k < K; k++) {
    const prevPath = kPaths[k - 1];
    for (let i = 0; i < prevPath.nodeIds.length - 1; i++) {
      const spurNode = prevPath.nodeIds[i];
      const rootPath = prevPath.nodeIds.slice(0, i + 1);
      const blockedEdges = new Set();
      const blockedNodes = new Set();

      for (const kp of kPaths) {
        if (kp.nodeIds.length > i && kp.nodeIds.slice(0, i + 1).join('|') === rootPath.join('|')) {
          const edgeKey = [kp.nodeIds[i], kp.nodeIds[i + 1]].sort().join('|');
          blockedEdges.add(edgeKey);
        }
      }
      for (const n of rootPath.slice(0, -1)) blockedNodes.add(n);

      const spurResult = dijkstraFull(spurNode, endId, blockedEdges, blockedNodes);
      if (!spurResult) continue;

      const rootCoords = rootPath.map(id => {
        if (id.startsWith('B_')) {
          const bl = buildingsWithCategory.find(x => x.id === parseInt(id.replace('B_', '')));
          return bl ? [bl.lat, bl.lng] : null;
        }
        return ROAD_NODES[id];
      }).filter(Boolean);

      let rootDist = 0;
      for (let j = 0; j < rootPath.length - 1; j++) {
        const a = rootPath[j], b = rootPath[j + 1];
        const cA = a.startsWith('B_') ? (() => { const bl = buildingsWithCategory.find(x => x.id === parseInt(a.replace('B_',''))); return bl ? [bl.lat, bl.lng] : null; })() : ROAD_NODES[a];
        const cB = b.startsWith('B_') ? (() => { const bl = buildingsWithCategory.find(x => x.id === parseInt(b.replace('B_',''))); return bl ? [bl.lat, bl.lng] : null; })() : ROAD_NODES[b];
        if (cA && cB) rootDist += haversine(cA, cB);
      }

      const totalNodeIds = [...rootPath, ...spurResult.nodeIds.slice(1)];
      const totalPath = [...rootCoords, ...spurResult.path.slice(1)];
      const totalDist = rootDist + spurResult.totalDist;
      const pathKey = totalNodeIds.join('->');
      const isDup = kPaths.some(p => p.nodeIds.join('->') === pathKey) ||
                    candidates.some(c => c.nodeIds.join('->') === pathKey);
      if (!isDup) candidates.push({ nodeIds: totalNodeIds, path: totalPath, totalDist });
    }

    if (candidates.length === 0) break;
    candidates.sort((a, b) => a.totalDist - b.totalDist);
    kPaths.push(candidates.shift());
  }
  return kPaths;
}

// ═══════════════════════════════════════════════════════════════════════════════
// LEAFLET ICON HELPERS
// ═══════════════════════════════════════════════════════════════════════════════
function makeIcon(category) {
  const cat = CATEGORIES[category];
  return L.divIcon({
    className: '',
    html: `<div style="width:30px;height:30px;border-radius:50% 50% 50% 0;background:${cat.color};display:flex;align-items:center;justify-content:center;font-size:13px;transform:rotate(-45deg);box-shadow:0 2px 8px rgba(0,0,0,0.35);border:2px solid white;"><span style="transform:rotate(45deg)">${cat.icon}</span></div>`,
    iconSize: [30, 30], iconAnchor: [15, 30], popupAnchor: [0, -32],
  });
}

function makeHighlightIcon(category) {
  const cat = CATEGORIES[category];
  return L.divIcon({
    className: '',
    html: `<div style="width:40px;height:40px;border-radius:50% 50% 50% 0;background:${cat.color};display:flex;align-items:center;justify-content:center;font-size:18px;transform:rotate(-45deg);box-shadow:0 0 0 4px ${cat.color}44,0 4px 12px rgba(0,0,0,0.4);border:2px solid white;"><span style="transform:rotate(45deg)">${cat.icon}</span></div>`,
    iconSize: [40, 40], iconAnchor: [20, 40], popupAnchor: [0, -42],
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════
export default function MapPage() {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef({});
  const routeLayersRef = useRef([]);
  const endpointMarkersRef = useRef([]);

  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState('all');
  const [selected, setSelected] = useState(null);
  const [source, setSource] = useState('');
  const [destination, setDestination] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [routeInfo, setRouteInfo] = useState(null);
  const [allPaths, setAllPaths] = useState([]);
  const [selectedPathIndex, setSelectedPathIndex] = useState(0);

  const filtered = buildingsWithCategory.filter(p => {
    const matchSearch = p.name.toLowerCase().includes(search.toLowerCase());
    const matchFilter = activeFilter === 'all' || p.category === activeFilter;
    return matchSearch && matchFilter;
  });

  // ── Initialise map ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (mapInstanceRef.current) return;
    const map = L.map(mapRef.current, {
      center: [17.0901, 82.0692],
      zoom: 16,
      zoomControl: false,
    });
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 20,
    }).addTo(map);

    // Draw road network
    for (const [a, b] of ROAD_EDGES) {
      L.polyline([ROAD_NODES[a], ROAD_NODES[b]], {
        color: '#94a3b8', weight: 3, opacity: 0.55, dashArray: '5 5',
      }).addTo(map);
    }

    // Add building markers
    buildingsWithCategory.forEach(p => {
      const marker = L.marker([p.lat, p.lng], { icon: makeIcon(p.category) })
        .addTo(map)
        .bindPopup(`
          <div style="font-family:'Syne',sans-serif;min-width:160px;">
            <div style="font-size:13px;font-weight:700;color:#1e293b;margin-bottom:4px;">${p.name}</div>
            <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">
              ${CATEGORIES[p.category].icon} ${CATEGORIES[p.category].label}
            </div>
          </div>
        `, { offset: [0, -28] });
      marker.on('click', () => setSelected(p));
      markersRef.current[p.id] = marker;
    });

    mapInstanceRef.current = map;
  }, []);

  // ── Clear route ─────────────────────────────────────────────────────────────
  const clearRoute = (keepSelections = false) => {
    const map = mapInstanceRef.current;
    if (!map) return;
    routeLayersRef.current.forEach(l => map.removeLayer(l));
    routeLayersRef.current = [];
    endpointMarkersRef.current.forEach(m => map.removeLayer(m));
    endpointMarkersRef.current = [];
    setRouteInfo(null);
    setAllPaths([]);
    setSelectedPathIndex(0);
    if (!keepSelections) { setSource(''); setDestination(''); }
  };

  const PATH_STYLES = [
    { color: '#22d3ee', label: 'Route 1' },
    { color: '#a78bfa', label: 'Route 2' },
    { color: '#fb923c', label: 'Route 3' },
  ];

  const drawAllPaths = (paths, selIdx, map) => {
    routeLayersRef.current.forEach(l => map.removeLayer(l));
    routeLayersRef.current = [];
    paths.forEach((p, i) => {
      const style = PATH_STYLES[i] || PATH_STYLES[0];
      const isSel = i === selIdx;
      const glow = L.polyline(p.path, { color: style.color, weight: isSel ? 14 : 8, opacity: isSel ? 0.3 : 0.1 }).addTo(map);
      const line = L.polyline(p.path, { color: style.color, weight: isSel ? 5 : 3, opacity: isSel ? 1.0 : 0.4, lineJoin: 'round', lineCap: 'round' }).addTo(map);
      const layers = [glow, line];
      if (isSel) {
        const dash = L.polyline(p.path, { color: '#ffffff', weight: 2, opacity: 0.6, dashArray: '6 10' }).addTo(map);
        layers.push(dash);
      }
      routeLayersRef.current.push(...layers);
    });
  };

  // ── Find route ───────────────────────────────────────────────────────────────
  const findRoute = () => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const startBld = buildingsWithCategory.find(b => b.name === source);
    const endBld   = buildingsWithCategory.find(b => b.name === destination);
    if (!startBld || !endBld) { alert('Please select both source and destination.'); return; }
    if (startBld.id === endBld.id) { alert('Source and destination cannot be the same.'); return; }

    clearRoute(true);
    const paths = yenKShortestPaths(`B_${startBld.id}`, `B_${endBld.id}`, 3);

    if (paths.length === 0) {
      alert('No connected road path found between selected places. Please check road network lines in GeoJSON.');
      return;
    } else {
      setAllPaths(paths);
      setSelectedPathIndex(0);
      drawAllPaths(paths, 0, map);
      const bounds = L.latLngBounds(paths.flatMap(p => p.path));
      map.fitBounds(bounds, { padding: [80, 80] });
      setRouteInfo({ dist: paths[0].totalDist, time: Math.ceil((paths[0].totalDist / 1000) / 5 * 60), found: true });
    }

    const mkLabel = (bld, label, color) => L.marker([bld.lat, bld.lng], {
      icon: L.divIcon({
        className: '',
        html: `<div style="background:${color};color:white;font-weight:800;font-size:11px;padding:4px 10px;border-radius:20px;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.4);font-family:sans-serif;border:2px solid white;">${label}</div>`,
        iconAnchor: [28, 10],
      }),
    }).addTo(map);
    endpointMarkersRef.current.push(
      mkLabel(startBld, '🟢 START', '#22c55e'),
      mkLabel(endBld,   '🔴 END',   '#ef4444'),
    );
  };

  const selectPath = (idx) => {
    const map = mapInstanceRef.current;
    if (!map || !allPaths.length) return;
    setSelectedPathIndex(idx);
    drawAllPaths(allPaths, idx, map);
    const sel = allPaths[idx];
    setRouteInfo({ dist: sel.totalDist, time: Math.ceil((sel.totalDist / 1000) / 5 * 60), found: true });
  };

  const flyTo = (p) => {
    setSelected(p);
    const map = mapInstanceRef.current;
    if (!map) return;
    map.flyTo([p.lat, p.lng], 18, { duration: 0.8 });
    const marker = markersRef.current[p.id];
    if (marker) {
      marker.setIcon(makeHighlightIcon(p.category));
      setTimeout(() => marker.setIcon(makeIcon(p.category)), 2000);
      marker.openPopup();
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden', fontFamily: "'Syne', sans-serif", background: '#0f172a' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&display=swap');
        .loc-item:hover { background: rgba(255,255,255,0.07) !important; }
        .loc-item.active-item { background: rgba(59,130,246,0.15) !important; border-left-color: #3b82f6 !important; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }
        .sel { background:#1e293b; color:#f1f5f9; border:1px solid #334155; border-radius:8px; padding:10px 12px; width:100%; font-family:inherit; font-size:13px; outline:none; cursor:pointer; margin-bottom:8px; }
        .sel:focus { border-color:#22d3ee; }
        .route-btn { width:100%; padding:12px; background:#22d3ee; color:#0f172a; border:none; border-radius:8px; cursor:pointer; font-family:inherit; font-size:13px; font-weight:800; letter-spacing:0.03em; transition:all 0.2s; }
        .route-btn:hover { background:#06b6d4; }
        .route-btn:disabled { background:#1e3a5f; color:#475569; cursor:not-allowed; }
        .clear-btn { width:100%; padding:8px; background:transparent; color:#64748b; border:1px solid #334155; border-radius:8px; cursor:pointer; font-family:inherit; font-size:12px; transition:all 0.2s; margin-top:6px; }
        .clear-btn:hover { border-color:#ef4444; color:#ef4444; }
        .filt-btn { padding:4px 10px; border-radius:20px; border:none; cursor:pointer; font-size:11px; font-weight:600; font-family:inherit; letter-spacing:0.05em; transition:all 0.2s; }
        .filt-btn:hover { opacity:0.85; transform:translateY(-1px); }
      `}</style>

      {/* ── SIDEBAR ─────────────────────────────────────────────────────────── */}
      <div style={{ width: sidebarOpen ? 300 : 0, minWidth: sidebarOpen ? 300 : 0, overflow: 'hidden', transition: 'all 0.3s ease', display: 'flex', flexDirection: 'column', background: '#0f172a', borderRight: '1px solid #1e293b', zIndex: 10 }}>

        {/* Header */}
        <div style={{ padding: '20px 16px 14px', borderBottom: '1px solid #1e293b' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#22d3ee', boxShadow: '0 0 8px #22d3ee' }} />
            <span style={{ fontSize: 10, color: '#64748b', letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 700 }}>Aditya University</span>
          </div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#f1f5f9', letterSpacing: '-0.03em', lineHeight: 1.2 }}>Campus<br />Navigator</h1>
          <p style={{ margin: '5px 0 0', fontSize: 11, color: '#475569' }}>{buildingsWithCategory.length} locations · road-based routing</p>
        </div>

        {/* Route Planner */}
        <div style={{ padding: '14px 16px', borderBottom: '1px solid #1e293b' }}>
          <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>🗺️ Route Planner</div>
          <select className="sel" value={source} onChange={e => setSource(e.target.value)}>
            <option value="">📍 Select Source</option>
            {buildingsWithCategory.map(p => <option key={`s-${p.id}`} value={p.name}>{p.name}</option>)}
          </select>
          <select className="sel" value={destination} onChange={e => setDestination(e.target.value)}>
            <option value="">🏁 Select Destination</option>
            {buildingsWithCategory.map(p => <option key={`d-${p.id}`} value={p.name}>{p.name}</option>)}
          </select>
          <button className="route-btn" onClick={findRoute} disabled={!source || !destination}>Find Optimal Route →</button>
          {routeInfo && <button className="clear-btn" onClick={() => clearRoute(false)}>✕ Clear Route</button>}
        </div>

        {/* Route Info + Path Selector */}
        {routeInfo && (
          <div style={{ borderBottom: '1px solid #1e293b' }}>
            <div style={{ padding: '12px 16px', background: routeInfo.found ? 'rgba(34,211,238,0.06)' : 'rgba(249,115,22,0.06)', borderBottom: allPaths.length > 1 ? '1px solid #1e293b' : 'none' }}>
              <div style={{ fontSize: 10, color: routeInfo.found ? '#22d3ee' : '#f97316', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
                {routeInfo.found ? `✅ ${PATH_STYLES[selectedPathIndex]?.label || 'Route'} Selected` : '⚠️ Straight-Line Fallback'}
              </div>
              <div style={{ display: 'flex', gap: 20 }}>
                <div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: '#f1f5f9' }}>
                    {routeInfo.dist >= 1000 ? `${(routeInfo.dist / 1000).toFixed(2)} km` : `${Math.round(routeInfo.dist)} m`}
                  </div>
                  <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>Distance</div>
                </div>
                <div style={{ width: 1, background: '#1e293b' }} />
                <div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: '#f1f5f9' }}>~{routeInfo.time < 1 ? '<1' : routeInfo.time} min</div>
                  <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>Walking @ 5 km/h</div>
                </div>
              </div>
            </div>

            {allPaths.length > 1 && (
              <div style={{ padding: '10px 12px' }}>
                <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
                  🔀 {allPaths.length} Routes Found — Choose One
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {allPaths.map((p, i) => {
                    const style = PATH_STYLES[i] || PATH_STYLES[0];
                    const isSel = i === selectedPathIndex;
                    const distLabel = p.totalDist >= 1000 ? `${(p.totalDist / 1000).toFixed(2)} km` : `${Math.round(p.totalDist)} m`;
                    const timeLabel = Math.ceil((p.totalDist / 1000) / 5 * 60);
                    const extraPct = i === 0 ? null : Math.round(((p.totalDist - allPaths[0].totalDist) / allPaths[0].totalDist) * 100);
                    return (
                      <div key={i} onClick={() => selectPath(i)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 9, border: `2px solid ${isSel ? style.color : '#1e293b'}`, background: isSel ? `${style.color}15` : '#0f172a', cursor: 'pointer', transition: 'all 0.15s' }}>
                        <div style={{ width: 4, height: 36, borderRadius: 4, background: style.color, flexShrink: 0, boxShadow: isSel ? `0 0 8px ${style.color}` : 'none' }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                            <span style={{ fontSize: 12, fontWeight: 700, color: isSel ? style.color : '#e2e8f0' }}>{style.label}</span>
                            {i === 0 && <span style={{ fontSize: 9, background: '#22c55e22', color: '#22c55e', borderRadius: 4, padding: '1px 5px', fontWeight: 700, textTransform: 'uppercase' }}>Shortest</span>}
                            {extraPct !== null && <span style={{ fontSize: 9, background: '#ffffff11', color: '#94a3b8', borderRadius: 4, padding: '1px 5px', fontWeight: 600 }}>+{extraPct}%</span>}
                          </div>
                          <div style={{ fontSize: 11, color: '#64748b' }}>{distLabel} · ~{timeLabel < 1 ? '<1' : timeLabel} min · {p.nodeIds.length - 2} waypoints</div>
                        </div>
                        {isSel && <div style={{ fontSize: 14, color: style.color }}>✓</div>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Search */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #1e293b' }}>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: '#475569' }}>🔍</span>
            <input type="text" placeholder="Search locations..." value={search} onChange={e => setSearch(e.target.value)}
              style={{ width: '100%', padding: '8px 10px 8px 30px', background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#f1f5f9', fontSize: 13, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }} />
          </div>
        </div>

        {/* Category filters */}
        <div style={{ padding: '10px 16px', display: 'flex', gap: 5, flexWrap: 'wrap', borderBottom: '1px solid #1e293b' }}>
          {[['all', { label: 'All', color: '#3b82f6', icon: '' }], ...Object.entries(CATEGORIES)].map(([key, cat]) => (
            <button key={key} className="filt-btn" onClick={() => setActiveFilter(key)}
              style={{ background: activeFilter === key ? (key === 'all' ? '#3b82f6' : cat.color) : '#1e293b', color: activeFilter === key ? 'white' : '#94a3b8', boxShadow: activeFilter === key ? '0 0 0 2px white' : 'none' }}>
              {cat.icon} {cat.label.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Location list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
          {filtered.length === 0 && <div style={{ padding: '24px', textAlign: 'center', color: '#475569', fontSize: 13 }}>No locations found</div>}
          {filtered.map(p => {
            const cat = CATEGORIES[p.category];
            const isActive = selected?.id === p.id;
            return (
              <div key={p.id} className={`loc-item ${isActive ? 'active-item' : ''}`} onClick={() => flyTo(p)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 16px', cursor: 'pointer', borderLeft: '3px solid transparent', transition: 'all 0.15s' }}>
                <div style={{ width: 30, height: 30, borderRadius: 7, background: cat.color + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0 }}>{cat.icon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                  <div style={{ fontSize: 10, color: cat.color, marginTop: 1, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>{cat.label}</div>
                </div>
                <span style={{ color: '#334155', fontSize: 11 }}>›</span>
              </div>
            );
          })}
        </div>

        {/* Selected building info */}
        {selected && (
          <div style={{ padding: '14px 16px', borderTop: '1px solid #1e293b', background: '#0f172a' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 10, color: CATEGORIES[selected.category].color, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 3 }}>
                  {CATEGORIES[selected.category].icon} {CATEGORIES[selected.category].label}
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#f1f5f9' }}>{selected.name}</div>
                <div style={{ fontSize: 10, color: '#475569', marginTop: 3, fontFamily: 'monospace' }}>
                  {selected.lat.toFixed(5)}°N  {selected.lng.toFixed(5)}°E
                </div>
              </div>
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 16, padding: 0 }}>✕</button>
            </div>
          </div>
        )}
      </div>

      {/* ── MAP ─────────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, position: 'relative' }}>
        <button onClick={() => setSidebarOpen(o => !o)}
          style={{ position: 'absolute', top: 16, left: 16, zIndex: 1000, width: 34, height: 34, borderRadius: 8, background: '#0f172a', border: '1px solid #1e293b', color: '#94a3b8', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.4)' }}>
          {sidebarOpen ? '◀' : '▶'}
        </button>

        {/* Category counts */}
        <div style={{ position: 'absolute', top: 16, left: 62, zIndex: 1000, display: 'flex', gap: 6 }}>
          {Object.entries(CATEGORIES).map(([key, cat]) => (
            <div key={key} style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 7, padding: '5px 10px', display: 'flex', alignItems: 'center', gap: 5, boxShadow: '0 2px 8px rgba(0,0,0,0.4)' }}>
              <span style={{ fontSize: 11 }}>{cat.icon}</span>
              <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700 }}>{buildingsWithCategory.filter(p => p.category === key).length}</span>
            </div>
          ))}
        </div>

        <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
      </div>
    </div>
  );
}