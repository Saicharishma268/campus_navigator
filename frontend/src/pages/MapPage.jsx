import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/useAuth';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import campusGeoJsonRaw from '../data/map.geojson?raw';
import { getAllRoadStatuses } from '../services/adminService';
import { getOptimalRoutes } from '../services/routeService';
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
  const mergedEdges = connectNearbyRoadNodes(ROAD_NODES, ROAD_EDGES, 30);
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

const BASE_GRAPH = buildGraph();

// ═══════════════════════════════════════════════════════════════════════════════
// DIJKSTRA — returns { nodeIds, path, totalDist } or null
// adj: adjacency list, blockedEdgeSet: Set of "A|B" keys to skip
// ═══════════════════════════════════════════════════════════════════════════════
function dijkstra(startId, endId, adj, blockedEdgeSet = new Set(), blockedNodeSet = new Set()) {
  const allNodes = new Set([...Object.keys(adj), startId, endId]);
  const dist = {};
  const prev = {};
  for (const k of allNodes) { dist[k] = Infinity; prev[k] = null; }
  dist[startId] = 0;

  // Min-heap via sorted array (good enough for campus-scale graphs)
  const pq = [[0, startId]];

  while (pq.length > 0) {
    pq.sort((a, b) => a[0] - b[0]);
    const [cost, u] = pq.shift();
    if (cost > dist[u]) continue;
    if (u === endId) break;

    for (const { to, dist: w } of (adj[u] || [])) {
      if (blockedNodeSet.has(to) && to !== endId) continue;
      const ek = [u, to].sort().join('|');
      if (blockedEdgeSet.has(ek)) continue;
      const nd = cost + w;
      if (nd < dist[to]) {
        dist[to] = nd;
        prev[to] = u;
        pq.push([nd, to]);
      }
    }
  }

  if (dist[endId] === Infinity) return null;

  // Reconstruct node path
  const nodeIds = [];
  let cur = endId;
  while (cur !== null) { nodeIds.unshift(cur); cur = prev[cur]; }

  const path = nodeIds.map(id => {
    if (id.startsWith('B_')) {
      const bld = buildingsWithCategory.find(b => b.id === parseInt(id.replace('B_', '')));
      return bld ? [bld.lat, bld.lng] : null;
    }
    return ROAD_NODES[id] || null;
  }).filter(Boolean);

  return { nodeIds, path, totalDist: dist[endId] };
}

// ═══════════════════════════════════════════════════════════════════════════════
// DISCOURAGING ALGORITHM (Edge-Penalty / Iterative Penalisation)
// Finds K structurally-different paths by heavily penalising edges already used
// in previously found paths, then running Dijkstra again on the penalised graph.
// Each successive path is forced onto roads not yet used → genuinely distinct routes.
// ═══════════════════════════════════════════════════════════════════════════════
function discouragingKPaths(startId, endId, K = 3, globalBlockedEdges = new Set()) {
  // Helper: build a penalised adjacency list by multiplying used-edge weights
  function buildPenalisedAdj(usedEdgeSets, penaltyFactor) {
    const adj = {};
    for (const [nodeId, neighbours] of Object.entries(BASE_GRAPH)) {
      adj[nodeId] = neighbours.map(({ to, dist }) => {
        const ek = [nodeId, to].sort().join('|');
        // Count how many previous paths used this edge
        const useCount = usedEdgeSets.filter(s => s.has(ek)).length;
        // Exponential penalty: each reuse multiplies cost further
        const penalised = dist * Math.pow(penaltyFactor, useCount);
        return { to, dist: penalised };
      });
    }
    return adj;
  }

  // Helper: extract the set of edge-keys for a given nodeIds path
  function edgeSetFromNodeIds(nodeIds) {
    const s = new Set();
    for (let i = 0; i < nodeIds.length - 1; i++) {
      s.add([nodeIds[i], nodeIds[i + 1]].sort().join('|'));
    }
    return s;
  }

  // Helper: real (unpenalised) distance for a nodeIds path
  function realDist(nodeIds) {
    let total = 0;
    for (let i = 0; i < nodeIds.length - 1; i++) {
      const u = nodeIds[i], v = nodeIds[i + 1];
      const edge = (BASE_GRAPH[u] || []).find(e => e.to === v);
      total += edge ? edge.dist : 0;
    }
    return total;
  }

  // Helper: coord path from nodeIds
  function toCoordsPath(nodeIds) {
    return nodeIds.map(id => {
      if (id.startsWith('B_')) {
        const bld = buildingsWithCategory.find(b => b.id === parseInt(id.replace('B_', '')));
        return bld ? [bld.lat, bld.lng] : null;
      }
      return ROAD_NODES[id] || null;
    }).filter(Boolean);
  }

  // Penalty factor: 8× per reuse makes each successive path take clearly different roads
  const PENALTY_FACTOR = 8;

  const kPaths = [];
  const usedEdgeSets = [];
  const seenKeys = new Set();

  for (let k = 0; k < K; k++) {
    // Build adjacency with penalties for all previously found paths
    const penAdj = buildPenalisedAdj(usedEdgeSets, PENALTY_FACTOR);

    // Run Dijkstra on penalised graph (still respects globally blocked edges)
    const result = dijkstra(startId, endId, penAdj, globalBlockedEdges);
    if (!result) break;

    const pathKey = result.nodeIds.join('>');
    if (seenKeys.has(pathKey)) break; // duplicate — stop
    seenKeys.add(pathKey);

    const trueDistance = realDist(result.nodeIds);
    const coordPath    = toCoordsPath(result.nodeIds);

    kPaths.push({ nodeIds: result.nodeIds, path: coordPath, totalDist: trueDistance });
    usedEdgeSets.push(edgeSetFromNodeIds(result.nodeIds));
  }

  return kPaths;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PATH DEDUPLICATION — remove paths that are visually too similar
// Two paths are "visually same" if every point on one is within THRESHOLD meters
// of the nearest point on the other. This removes Yen's near-duplicate paths
// that differ only by a few sub-metre intermediate nodes on the same road.
// ═══════════════════════════════════════════════════════════════════════════════
function pointToPathMinDist(pt, pathCoords) {
  let minDist = Infinity;
  for (const c of pathCoords) {
    const d = haversine(pt, c);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

function hausdorffDistance(pathA, pathB) {
  // One-sided: max of min distances from A→B
  const fwd = Math.max(...pathA.map(pt => pointToPathMinDist(pt, pathB)));
  const bwd = Math.max(...pathB.map(pt => pointToPathMinDist(pt, pathA)));
  return Math.max(fwd, bwd);
}

function deduplicatePaths(paths, thresholdMeters = 15) {
  const unique = [];
  for (const p of paths) {
    const isDuplicate = unique.some(u => hausdorffDistance(p.path, u.path) < thresholdMeters);
    if (!isDuplicate) unique.push(p);
    if (unique.length >= 3) break;
  }
  return unique;
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
  const { isAuthenticated } = useAuth();
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
  const [globalBlockedEdges, setGlobalBlockedEdges] = useState(new Set());
  const [roadSegments, setRoadSegments] = useState([]);
  const [mapReady, setMapReady] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  // Backend-computed optimal routes (ranked, scored)
  const [optimalRoutes, setOptimalRoutes] = useState([]); // scored routes from API
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState(null);
  const [activeOptimalIdx, setActiveOptimalIdx] = useState(0); // which route card is selected

  const filtered = buildingsWithCategory.filter(p => {
    const matchSearch = p.name.toLowerCase().includes(search.toLowerCase());
    const matchFilter = activeFilter === 'all' || p.category === activeFilter;
    return matchSearch && matchFilter;
  });

  // ── Fetch blocked edges from backend ────────────────────────────────────────
  useEffect(() => {
    getAllRoadStatuses()
      .then(data => {
        const blocked = new Set(
          (data.segments || [])
            .filter(s => s.blocked)
            .map(s => s.edgeKey)
        );
        setGlobalBlockedEdges(blocked);
        setRoadSegments(data.segments || []);
      })
      .catch(() => {
        // If backend is unreachable, fall back to no blocked edges
        setGlobalBlockedEdges(new Set());
      });
  }, []);

  const roadLayersRef = useRef([]);

  // ── Redraw road network when blocked edges change ───────────────────────────
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    roadLayersRef.current.forEach(l => map.removeLayer(l));
    roadLayersRef.current = [];
    for (const [a, b] of ROAD_EDGES) {
      const edgeKey = [a, b].sort().join('|');
      const isBlocked = globalBlockedEdges.has(edgeKey);
      const layer = L.polyline([ROAD_NODES[a], ROAD_NODES[b]], {
        color: isBlocked ? '#ef4444' : '#94a3b8',
        weight: isBlocked ? 4 : 3,
        opacity: isBlocked ? 0.85 : 0.55,
        dashArray: isBlocked ? '6 4' : '5 5',
      }).addTo(map);
      roadLayersRef.current.push(layer);
    }
  }, [globalBlockedEdges, mapReady]);

  // ── Auto-route from URL parameters ──────────────────────────────────────────
  useEffect(() => {
  if (!mapReady) return;
  const params = new URLSearchParams(window.location.search);
  const src = params.get('source');
  const dest = params.get('destination');

  if (src && dest) {
    setSource(src);
    setDestination(dest);
    findRoute(src, dest);
  }
}, [mapReady]);

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

    // Draw road nodes as small dots with permanent labels
    // (Road edges are drawn/redrawn by the globalBlockedEdges useEffect)
    for (const [nodeId, coord] of Object.entries(ROAD_NODES)) {
      L.circleMarker(coord, {
        radius: 4,
        color: '#0f172a',
        weight: 1.5,
        fillColor: '#22d3ee',
        fillOpacity: 1,
        interactive: false,
        pane: 'shadowPane',
      })
        .addTo(map)
        .bindTooltip(nodeId, {
          permanent: true,
          direction: 'top',
          offset: [0, -6],
          className: 'node-label',
        });
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
    setMapReady(true);
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
    setRightPanelOpen(false);
    setOptimalRoutes([]);
    setActiveOptimalIdx(0);
    setRouteError(null);
    if (!keepSelections) { setSource(''); setDestination(''); }
  };

  const PATH_STYLES = [
    { color: '#22d3ee', label: 'Optimal Route',   rank: '1st', badge: 'BEST',   badgeColor: '#22c55e', icon: '🥇' },
    { color: '#a78bfa', label: 'Alternate Route',  rank: '2nd', badge: 'ALT',    badgeColor: '#a78bfa', icon: '🥈' },
    { color: '#fb923c', label: 'Scenic Route',     rank: '3rd', badge: 'SCENIC', badgeColor: '#fb923c', icon: '🥉' },
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

  // ── Draw a route from node IDs (resolves via ROAD_NODES) ────────────────────
  const nodeIdsToCoords = (nodeIds) => {
    return nodeIds
      .map(id => {
        if (id.startsWith('B_')) {
          const bld = buildingsWithCategory.find(b => b.id === parseInt(id.replace('B_', '')));
          return bld ? [bld.lat, bld.lng] : null;
        }
        return ROAD_NODES[id] || null;
      })
      .filter(Boolean);
  };

  // Draw all scored routes on the map; highlight the selected one
  const drawScoredRoutes = (routes, selIdx, map) => {
    routeLayersRef.current.forEach(l => map.removeLayer(l));
    routeLayersRef.current = [];

    const COLORS = ['#22d3ee', '#a78bfa', '#fb923c'];

    routes.forEach((route, i) => {
      const coords = nodeIdsToCoords(route.nodes);
      if (coords.length < 2) return;
      const color  = COLORS[i] || '#94a3b8';
      const isSel  = i === selIdx;

      const glow = L.polyline(coords, {
        color, weight: isSel ? 16 : 8, opacity: isSel ? 0.25 : 0.08,
      }).addTo(map);
      const line = L.polyline(coords, {
        color, weight: isSel ? 5 : 3, opacity: isSel ? 1.0 : 0.35,
        lineJoin: 'round', lineCap: 'round',
      }).addTo(map);
      const layers = [glow, line];
      if (isSel) {
        const dash = L.polyline(coords, {
          color: '#ffffff', weight: 2, opacity: 0.7, dashArray: '6 10',
        }).addTo(map);
        layers.push(dash);
      }
      routeLayersRef.current.push(...layers);
    });
  };

  // ── Find route — calls backend POST /api/routes/optimal ──────────────────
  const findRoute = async (overrideSrc, overrideDest) => {
    // If called via React onClick, the first arg is an Event object. We must ignore it.
    const s = typeof overrideSrc === 'string' ? overrideSrc : source;
    const d = typeof overrideDest === 'string' ? overrideDest : destination;
    
    const map = mapInstanceRef.current;
    if (!map) return;
    const startBld = buildingsWithCategory.find(b => b.name === s);
    const endBld   = buildingsWithCategory.find(b => b.name === d);
    if (!startBld || !endBld) { 
      alert('Please select both source and destination.'); 
      return; 
    }
    if (startBld.id === endBld.id) { 
      alert('Source and destination cannot be the same.'); 
      return; 
    }

    clearRoute(true);
    setRouteLoading(true);
    setRouteError(null);
    setRightPanelOpen(true);

    // ── Step 1: Always compute paths locally via Discouraging Algorithm ─────────
    // The backend may return identical routes; local algo guarantees structural diversity.
    const rawPaths = discouragingKPaths(`B_${startBld.id}`, `B_${endBld.id}`, 6, globalBlockedEdges);
    const paths = deduplicatePaths(rawPaths, 40);

    if (paths.length === 0) {
      setRouteError('No connected road path found between selected places.');
      setRouteLoading(false);
      return;
    }

    // -- Step 2: Fetch FRESH road segments to get live crowd data --
    let liveSegments = roadSegments;
    try {
      const freshData = await getAllRoadStatuses();
      if (freshData?.segments?.length > 0) {
        liveSegments = freshData.segments;
        const freshBlocked = new Set(liveSegments.filter(s => s.blocked).map(s => s.edgeKey));
        setGlobalBlockedEdges(freshBlocked);
        setRoadSegments(liveSegments);
      }
    } catch (_) { /* use cached */ }

    // -- Step 3: Score each path with live crowd data --
    // Build a fast lookup map: edgeKey → segment data
    const segmentMap = new Map();
    liveSegments.forEach(s => segmentMap.set(s.edgeKey, s));

    // Crowd penalty per segment (flat penalty added to score)
    const CROWD_PENALTY_LOCAL = { low: 0, medium: 20, high: 50 };

    // Crowd speed factor: high crowd slows walking speed
    const CROWD_SPEED_FACTOR = { low: 1.0, medium: 0.80, high: 0.65 };

    const scoredRoutes = paths.map((p) => {
      // Build the set of edge keys for this path — only road segments (N*|N*)
      // Building snap edges (B_x|Ny) are not in the backend and have no crowd data
      const pathEdgeKeys = [];
      for (let j = 0; j < p.nodeIds.length - 1; j++) {
        const a = p.nodeIds[j], b = p.nodeIds[j + 1];
        // Skip edges that involve building virtual nodes
        if (a.startsWith('B_') || b.startsWith('B_')) continue;
        pathEdgeKeys.push([a, b].sort().join('|'));
      }

      // Count crowd levels for ALL edges in path
      // Edges not in the backend default to 'low'
      const crowdCounts = { low: 0, medium: 0, high: 0 };
      let totalCrowdPenalty = 0;
      let blocked = false;

      pathEdgeKeys.forEach(ek => {
        const seg = segmentMap.get(ek);
        const level = (seg && seg.crowdLevel) ? seg.crowdLevel : 'low';
        crowdCounts[level]++;
        totalCrowdPenalty += CROWD_PENALTY_LOCAL[level];
        if (seg && seg.blocked) blocked = true;
      });

      // Dominant crowd = highest-severity crowd level present (not just most common)
      // If ANY segment is high → dominant is high; else if any medium → medium; else low
      const dominant =
        crowdCounts.high > 0 ? 'high' :
        crowdCounts.medium > 0 ? 'medium' : 'low';

      // Effective walking speed reduced by dominant crowd
      const speedFactor = CROWD_SPEED_FACTOR[dominant];
      const effectiveSpeedKmh = 5 * speedFactor;
      const timeMin = (p.totalDist / 1000 / effectiveSpeedKmh) * 60;

      // Score = distance (m) + time penalty (seconds) + crowd penalty
      // Multiply crowd penalty by path length factor so it's meaningful vs distance
      const crowdWeight = Math.max(1, pathEdgeKeys.length); // scale by number of edges
      //const score = Math.round(p.totalDist + timeMin * 60 + totalCrowdPenalty * crowdWeight);
const BLOCKED_PENALTY = 999999;
const score = Math.round(p.totalDist + timeMin * 60 + totalCrowdPenalty * crowdWeight + (blocked ? BLOCKED_PENALTY : 0));
      return {
        nodes:        p.nodeIds,
        distance:     Math.round(p.totalDist),
        time:         Math.round(timeMin * 10) / 10,
        crowdSummary: dominant === 'high' ? 'High' : dominant === 'medium' ? 'Medium' : 'Low',
        crowdCounts,
        blocked,
        score,
      };
    });

    // Sort by score ascending (best first)
    scoredRoutes.sort((a, b) => a.score - b.score);

    // (crowd data already applied from live fetch above)

    setOptimalRoutes(scoredRoutes);
    setActiveOptimalIdx(0);
    setAllPaths(paths);
    setSelectedPathIndex(0);
    setRouteLoading(false);

    // Draw all routes on map; best route (idx 0) highlighted
    drawScoredRoutes(scoredRoutes, 0, map);
    drawAllPaths(paths, 0, map);

    // Fit map to best route
    const recCoords = nodeIdsToCoords(scoredRoutes[0].nodes);
    if (recCoords.length > 1) {
      map.fitBounds(L.latLngBounds(recCoords), { padding: [80, 80] });
    }

    setRouteInfo({ dist: scoredRoutes[0].distance, time: scoredRoutes[0].time, found: true });

    // Source / Destination pin labels
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
        .node-label {
          background: rgba(15,23,42,0.85) !important;
          border: 1px solid #22d3ee !important;
          border-radius: 3px !important;
          color: #22d3ee !important;
          font-size: 9px !important;
          font-weight: 700 !important;
          font-family: monospace !important;
          padding: 1px 4px !important;
          white-space: nowrap !important;
          box-shadow: none !important;
          pointer-events: none !important;
        }
        .node-label::before { display: none !important; }
      `}</style>

      {/* ── SIDEBAR ─────────────────────────────────────────────────────────── */}
      <div style={{ width: sidebarOpen ? 300 : 0, minWidth: sidebarOpen ? 300 : 0, overflow: 'hidden', transition: 'all 0.3s ease', display: 'flex', flexDirection: 'column', background: '#0f172a', borderRight: '1px solid #1e293b', zIndex: 10, height: '100vh' }}>

        {/* Header — sticky, never scrolls away */}
        <div style={{ flexShrink: 0, padding: '20px 16px 14px', borderBottom: '1px solid #1e293b' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#22d3ee', boxShadow: '0 0 8px #22d3ee' }} />
            <span style={{ fontSize: 10, color: '#64748b', letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 700 }}>Aditya University</span>
          </div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#f1f5f9', letterSpacing: '-0.03em', lineHeight: 1.2 }}>Campus<br />Navigator</h1>
          <p style={{ margin: '5px 0 0', fontSize: 11, color: '#475569' }}>{buildingsWithCategory.length} locations · road-based routing</p>
        </div>

        {/* ── Scrollable body ─────────────────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>

        {/* Route Planner + Available Routes */}
        <div style={{ flexShrink: 0, padding: '14px 16px', borderBottom: '1px solid #1e293b' }}>
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

        {/* Search */}
        <div style={{ flexShrink: 0, padding: '12px 16px', borderBottom: '1px solid #1e293b' }}>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: '#475569' }}>🔍</span>
            <input type="text" placeholder="Search locations..." value={search} onChange={e => setSearch(e.target.value)}
              style={{ width: '100%', padding: '8px 10px 8px 30px', background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#f1f5f9', fontSize: 13, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }} />
          </div>
        </div>

        {/* Category filters */}
        <div style={{ flexShrink: 0, padding: '10px 16px', display: 'flex', gap: 5, flexWrap: 'wrap', borderBottom: '1px solid #1e293b' }}>
          {[['all', { label: 'All', color: '#3b82f6', icon: '' }], ...Object.entries(CATEGORIES)].map(([key, cat]) => (
            <button key={key} className="filt-btn" onClick={() => setActiveFilter(key)}
              style={{ background: activeFilter === key ? (key === 'all' ? '#3b82f6' : cat.color) : '#1e293b', color: activeFilter === key ? 'white' : '#94a3b8', boxShadow: activeFilter === key ? '0 0 0 2px white' : 'none' }}>
              {cat.icon} {cat.label.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Location list */}
        <div style={{ padding: '6px 0' }}>
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
        </div>{/* end scrollable body */}
      </div>

      {/* ── MAP ─────────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'row', overflow: 'hidden' }}>
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
        </div>{/* end map inner */}

        {/* ── RIGHT PANEL — Optimal Route Ranking ──────────────────────────── */}
        {rightPanelOpen && (() => {
          const ROUTE_COLORS = ['#22d3ee', '#a78bfa', '#fb923c'];
          const RANK_META = [
            { icon: '🥇', badge: 'BEST',  label: 'Best Route'  },
            { icon: '🥈', badge: '2ND',   label: '2nd Route'   },
            { icon: '🥉', badge: '3RD',   label: '3rd Route'   },
          ];
          const CROWD_CFG = {
            Low:    { color: '#22c55e', bg: 'rgba(34,197,94,0.12)',  barLevel: 0 },
            Medium: { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', barLevel: 1 },
            High:   { color: '#ef4444', bg: 'rgba(239,68,68,0.12)',  barLevel: 2 },
          };

          const recommended = optimalRoutes[0];
          const alternatives = optimalRoutes.slice(1);

          // Handle click on an alternative route card
          const viewRoute = (idx) => {
            const map = mapInstanceRef.current;
            if (!map || !optimalRoutes.length) return;
            setActiveOptimalIdx(idx);
            drawScoredRoutes(optimalRoutes, idx, map);
            const coords = nodeIdsToCoords(optimalRoutes[idx].nodes);
            if (coords.length > 1) map.fitBounds(L.latLngBounds(coords), { padding: [80, 80] });
          };

          const renderRouteCard = (route, rank, isSelected, onClick) => {
            if (!route) return null;
            const color   = ROUTE_COLORS[rank] || '#94a3b8';
            const meta    = RANK_META[rank] || RANK_META[0];
            const crowd   = route.crowdSummary || 'Low';
            const cc      = CROWD_CFG[crowd] || CROWD_CFG.Low;
            const distLabel = route.distance >= 1000
              ? `${(route.distance / 1000).toFixed(2)} km`
              : `${route.distance} m`;

            return (
              <div
                onClick={onClick}
                style={{
                  borderRadius: 12,
                  border: `2px solid ${isSelected ? color : '#1e293b'}`,
                  background: isSelected ? `linear-gradient(135deg, ${color}18, #0a111e)` : '#0f172a',
                  boxShadow: isSelected ? `0 0 20px ${color}30` : 'none',
                  marginBottom: 10,
                  overflow: 'hidden',
                  cursor: onClick ? 'pointer' : 'default',
                  transition: 'all 0.18s',
                }}
              >
                {/* Top accent bar */}
                <div style={{ height: 3, background: route.blocked ? '#ef4444' : color, opacity: isSelected ? 1 : 0.5 }} />

                <div style={{ padding: '12px 14px' }}>
                  {/* Header row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                    <span style={{ fontSize: 22, lineHeight: 1 }}>{meta.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                        <span style={{ fontSize: 13, fontWeight: 800, color: isSelected ? color : '#e2e8f0' }}>
                          {meta.label}
                        </span>
                        <span style={{
                          fontSize: 8, fontWeight: 800, padding: '2px 6px', borderRadius: 4,
                          textTransform: 'uppercase', letterSpacing: '0.06em',
                          background: isSelected ? color : '#1e293b',
                          color: isSelected ? '#0a111e' : color,
                          border: `1px solid ${color}`,
                        }}>{meta.badge}</span>
                        {/* Per-path score chip — always visible */}
                        <span style={{
                          fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 4,
                          background: '#0f172a', color: '#22d3ee',
                          border: '1px solid #22d3ee40', letterSpacing: '0.04em',
                          marginLeft: 'auto',
                        }}>Score: {route.score ?? '—'}</span>
                      </div>
                      {rank === 0 && (
                        <div style={{ fontSize: 10, color: '#22c55e', fontWeight: 600 }}>
                          ⭐ Automatically selected · lowest score
                        </div>
                      )}
                      {rank > 0 && recommended && (
                        <div style={{ fontSize: 10, color: '#475569' }}>
                          +{Math.round(((route.distance - recommended.distance) / Math.max(recommended.distance, 1)) * 100)}% longer · score {route.score}
                        </div>
                      )}
                    </div>
                    {/* Selection ring */}
                    <div style={{
                      width: 22, height: 22, borderRadius: '50%',
                      border: `2px solid ${isSelected ? color : '#334155'}`,
                      background: isSelected ? color : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0, transition: 'all 0.18s',
                    }}>
                      {isSelected && <span style={{ fontSize: 11, color: '#0a111e', fontWeight: 800 }}>✓</span>}
                    </div>
                  </div>

                  {/* Stats grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
                    <div style={{ background: '#1e293b', borderRadius: 8, padding: '8px 10px' }}>
                      <div style={{ fontSize: 9, color: '#475569', marginBottom: 2 }}>📏 DISTANCE</div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: '#f1f5f9' }}>{distLabel}</div>
                    </div>
                    <div style={{ background: '#1e293b', borderRadius: 8, padding: '8px 10px' }}>
                      <div style={{ fontSize: 9, color: '#475569', marginBottom: 2 }}>⏱ EST. TIME</div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: '#f1f5f9' }}>~{route.time} min</div>
                    </div>
                  </div>

                  {/* Crowd level */}
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    background: cc.bg, border: `1px solid ${cc.color}30`,
                    borderRadius: 8, padding: '7px 10px', marginBottom: 7,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: cc.color, boxShadow: `0 0 6px ${cc.color}` }} />
                      <div>
                        <div style={{ fontSize: 9, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Crowd</div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: cc.color }}>{crowd}</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 3 }}>
                      {[0, 1, 2].map(lvl => (
                        <div key={lvl} style={{
                          width: 6, height: 14, borderRadius: 3,
                          background: lvl <= cc.barLevel ? cc.color : '#1e293b',
                        }} />
                      ))}
                    </div>
                  </div>

                  {/* Path status */}
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    background: route.blocked ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.08)',
                    border: `1px solid ${route.blocked ? '#ef444430' : '#22c55e30'}`,
                    borderRadius: 8, padding: '7px 10px', marginBottom: rank > 0 ? 8 : 0,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span style={{ fontSize: 13 }}>{route.blocked ? '🚫' : '✅'}</span>
                      <div>
                        <div style={{ fontSize: 9, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Path Status</div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: route.blocked ? '#ef4444' : '#22c55e' }}>
                          {route.blocked ? 'Segment blocked' : 'All clear'}
                        </div>
                      </div>
                    </div>
                    <div style={{
                      fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 20,
                      background: route.blocked ? '#ef444420' : '#22c55e20',
                      color: route.blocked ? '#ef4444' : '#22c55e',
                      border: `1px solid ${route.blocked ? '#ef444440' : '#22c55e40'}`,
                    }}>
                      {route.blocked ? 'BLOCKED' : 'OPEN'}
                    </div>
                  </div>

                  {/* Score chip */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                    <span style={{ fontSize: 9, color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                      Score (lower = better)
                    </span>
                    <span style={{
                      fontSize: 12, fontWeight: 800, padding: '3px 10px', borderRadius: 20,
                      background: `${color}20`, color, border: `1px solid ${color}40`,
                    }}>
                      {route.score}
                    </span>
                  </div>

                  {/* View Route button for alternatives */}
                  {rank > 0 && onClick && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onClick(); }}
                      style={{
                        marginTop: 10, width: '100%', padding: '8px', borderRadius: 8,
                        background: isSelected ? color : 'transparent',
                        color: isSelected ? '#0a111e' : color,
                        border: `1px solid ${color}`,
                        cursor: 'pointer', fontWeight: 700, fontSize: 12,
                        fontFamily: 'inherit', transition: 'all 0.18s',
                      }}>
                      {isSelected ? '✓ Viewing this route' : 'View Route →'}
                    </button>
                  )}
                </div>
              </div>
            );
          };

          return (
            <div style={{
              width: 340, zIndex: 20, flexShrink: 0,
              background: '#0a111e',
              borderLeft: '1px solid #1e293b',
              display: 'flex', flexDirection: 'column',
              boxShadow: '-4px 0 24px rgba(0,0,0,0.5)',
              animation: 'slideInRight 0.3s ease',
            }}>
              <style>{`
                @keyframes slideInRight { from { transform: translateX(100%); opacity:0; } to { transform: translateX(0); opacity:1; } }
                .opt-scroll::-webkit-scrollbar { width: 4px; }
                .opt-scroll::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }
              `}</style>

              {/* Panel Header */}
              <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid #1e293b', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 2 }}>
                    <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 8px #22c55e' }} />
                    <span style={{ fontSize: 10, color: '#64748b', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                      Optimal Route Ranking
                    </span>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9' }}>{source} → {destination}</div>
                  <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>
                    {routeLoading ? 'Analysing routes…' : `${optimalRoutes.length} route${optimalRoutes.length === 1 ? '' : 's'} analysed · real-time factors applied`}
                  </div>
                </div>
                <button onClick={() => { setRightPanelOpen(false); clearRoute(false); }}
                  style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#94a3b8', cursor: 'pointer', width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>✕</button>
              </div>

              {/* Scoring formula legend */}
              <div style={{ padding: '8px 16px', background: 'rgba(15,23,42,0.7)', borderBottom: '1px solid #1e293b', flexShrink: 0 }}>
                <div style={{ fontSize: 9, color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 5 }}>
                  Score = Distance + Time(crowd-adjusted speed) + Crowd Penalty × Edges
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  {[['#22c55e', 'Low (100% spd)'], ['#f59e0b', 'Med (80% spd,+20)'], ['#ef4444', 'High (65% spd,+50)']].map(([c, l]) => (
                    <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <div style={{ width: 7, height: 7, borderRadius: '50%', background: c }} />
                      <span style={{ fontSize: 9, color: '#64748b', fontWeight: 600 }}>{l}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Scrollable content */}
              <div className="opt-scroll" style={{ flex: 1, overflowY: 'auto', padding: '14px 14px' }}>

                {/* Loading state */}
                {routeLoading && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 0', gap: 14 }}>
                    <div style={{ width: 36, height: 36, border: '3px solid #1e293b', borderTop: '3px solid #22d3ee', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                    <div style={{ fontSize: 12, color: '#64748b' }}>Computing optimal routes…</div>
                    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                  </div>
                )}

                {/* Error state */}
                {routeError && !routeLoading && (
                  <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid #ef444440', borderRadius: 10, padding: '16px', textAlign: 'center' }}>
                    <div style={{ fontSize: 24, marginBottom: 8 }}>🚫</div>
                    <div style={{ fontSize: 12, color: '#ef4444', fontWeight: 700 }}>No Route Found</div>
                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 5 }}>{routeError}</div>
                  </div>
                )}

                {/* Routes */}
                {!routeLoading && !routeError && optimalRoutes.length > 0 && (<>

                  {/* ── Recommended Route section ──── */}
                  <div style={{ fontSize: 10, color: '#22c55e', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 6px #22c55e' }} />
                    Recommended Optimal Route
                  </div>
                  {renderRouteCard(recommended, 0, activeOptimalIdx === 0, () => viewRoute(0))}

                  {/* ── Alternative Routes section ─── */}
                  {alternatives.length > 0 && (
                    <>
                      <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', margin: '14px 0 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ flex: 1, height: 1, background: '#1e293b' }} />
                        Alternative Routes
                        <div style={{ flex: 1, height: 1, background: '#1e293b' }} />
                      </div>
                      {alternatives.map((route, i) =>
                        renderRouteCard(route, i + 1, activeOptimalIdx === i + 1, () => viewRoute(i + 1))
                      )}
                    </>
                  )}

                  {/* Multi-route proof section */}
                  <div style={{ marginTop: 6, background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10, padding: '12px 14px' }}>
                    <div style={{ fontSize: 9, color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                      ✦ Route Analysis Summary
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      <div style={{ fontSize: 11, color: '#64748b' }}>
                        <span style={{ color: '#22d3ee', fontWeight: 700 }}>{optimalRoutes.length}</span> routes computed via Discouraging Algorithm
                      </div>
                      <div style={{ fontSize: 11, color: '#64748b' }}>
                        Best score: <span style={{ color: '#22c55e', fontWeight: 700 }}>{recommended?.score}</span>
                        {alternatives[0] && <> · Next: <span style={{ color: '#a78bfa', fontWeight: 700 }}>{alternatives[0].score}</span></>}
                      </div>
                      <div style={{ fontSize: 11, color: '#64748b' }}>
                        Crowd factors: real-time from admin dashboard
                      </div>
                      <div style={{ fontSize: 11, color: '#64748b' }}>
                        Blocked segments: automatically excluded
                      </div>
                    </div>
                  </div>

                </>)}
              </div>

              {/* Footer */}
              <div style={{ padding: '10px 14px', borderTop: '1px solid #1e293b', flexShrink: 0, background: '#0a111e', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 9, color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Navigating Route {activeOptimalIdx + 1}</div>
                  {optimalRoutes[activeOptimalIdx] && (
                    <div style={{ fontSize: 11, color: ROUTE_COLORS[activeOptimalIdx] || '#22d3ee', fontWeight: 700, marginTop: 2 }}>
                      {optimalRoutes[activeOptimalIdx].distance} m · {optimalRoutes[activeOptimalIdx].time} min · {optimalRoutes[activeOptimalIdx].crowdSummary} crowd
                    </div>
                  )}
                </div>
                <button onClick={() => clearRoute(false)}
                  style={{ background: 'transparent', border: '1px solid #334155', borderRadius: 8, color: '#64748b', cursor: 'pointer', padding: '6px 12px', fontSize: 11, fontWeight: 600, fontFamily: 'inherit', transition: 'all 0.2s' }}
                  onMouseEnter={e => { e.target.style.borderColor = '#ef4444'; e.target.style.color = '#ef4444'; }}
                  onMouseLeave={e => { e.target.style.borderColor = '#334155'; e.target.style.color = '#64748b'; }}>
                  Clear
                </button>
              </div>
            </div>
          );
        })()}

      </div>
    </div>
  );
}