// src/routes/routes.js
const express    = require('express');
const path       = require('path');
const fs         = require('fs');
const Road       = require('../models/Road');
const RoadStatus = require('../models/RoadStatus');

const router = express.Router();

// ═══════════════════════════════════════════════════════════════════════════
// GEOJSON BUILDING LOOKUP — mirrors frontend buildBuildingsFromGeoJson
// ═══════════════════════════════════════════════════════════════════════════

function toLatLng(coord) { return [coord[1], coord[0]]; }

function cleanName(properties, fallback) {
  const raw = (properties || {}).name ?? (properties || {})['name '] ?? '';
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

let _geoCache = null;
function loadGeoJson() {
  if (_geoCache) return _geoCache;
  const geoJsonPath = path.resolve(__dirname, '../../../frontend/src/data/map.geojson');
  if (!fs.existsSync(geoJsonPath)) return null;
  _geoCache = JSON.parse(fs.readFileSync(geoJsonPath, 'utf8'));
  return _geoCache;
}

function buildRoadNodesFromGeoJson(geoJson) {
  const nodeIdByKey = new Map();
  const ROAD_NODES = {};
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

  const lineFeatures = (geoJson.features || []).filter(
    f => f && f.geometry && f.geometry.type === 'LineString'
  );

  for (const lf of lineFeatures) {
    const coords = lf.geometry.coordinates || [];
    for (let i = 0; i < coords.length; i++) {
      const [lat, lng] = toLatLng(coords[i]);
      getNodeId(lat, lng);
      if (i < coords.length - 1) {
        const [nextLat, nextLng] = toLatLng(coords[i + 1]);
        getNodeId(nextLat, nextLng);
      }
    }
  }

  return ROAD_NODES;
}

function findNearestRoadNode([lat, lng], ROAD_NODES) {
  let nearestId = null;
  let bestDist = Infinity;
  for (const [nodeId, nodeCoord] of Object.entries(ROAD_NODES)) {
    const d = haversine([lat, lng], nodeCoord);
    if (d < bestDist) { bestDist = d; nearestId = nodeId; }
  }
  return nearestId;
}

function getBuildingIndex() {
  const geoJson = loadGeoJson();
  if (!geoJson) return [];
  const ROAD_NODES = buildRoadNodesFromGeoJson(geoJson);
  const pointFeatures = (geoJson.features || []).filter(
    f => f && f.geometry && f.geometry.type === 'Point'
  );
  return pointFeatures.map((f, idx) => {
    const [lat, lng] = toLatLng(f.geometry.coordinates);
    const name = cleanName(f.properties, `Location ${idx + 1}`);
    const snap = findNearestRoadNode([lat, lng], ROAD_NODES);
    return { name, lat, lng, snap };
  });
}

function resolveBuildingToNode(nameOrNodeId, buildings) {
  if (/^N\d+$/.test(nameOrNodeId)) return nameOrNodeId;
  const lower = nameOrNodeId.toLowerCase();
  const match = buildings.find(b => b.name.toLowerCase() === lower);
  return match ? match.snap : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// GRAPH + PATHFINDING
// ═══════════════════════════════════════════════════════════════════════════

function buildGraph(roads, statusMap) {
  const adj = {};
  for (const road of roads) {
    const status = statusMap.get(road.edgeKey);
    if (status && status.blocked) continue;
    const { fromNode, toNode, distance } = road;
    if (!adj[fromNode]) adj[fromNode] = [];
    if (!adj[toNode])   adj[toNode]   = [];
    adj[fromNode].push({ to: toNode, dist: distance, edgeKey: road.edgeKey });
    adj[toNode].push({ to: fromNode, dist: distance, edgeKey: road.edgeKey });
  }
  return adj;
}

function dijkstra(graph, startId, endId, blockedEdges, blockedNodes) {
  blockedEdges = blockedEdges || new Set();
  blockedNodes = blockedNodes || new Set();
  const dist    = {};
  const prev    = {};
  const visited = new Set();
  for (const k of Object.keys(graph)) { dist[k] = Infinity; prev[k] = null; }
  if (!graph[startId] || !graph[endId]) return null;
  dist[startId] = 0;
  const pq = [[0, startId]];
  while (pq.length > 0) {
    pq.sort((a, b) => a[0] - b[0]);
    const [cost, u] = pq.shift();
    if (visited.has(u)) continue;
    visited.add(u);
    if (u === endId) break;
    for (const { to, dist: edgeDist, edgeKey } of (graph[u] || [])) {
      if (visited.has(to)) continue;
      if (blockedNodes.has(to) && to !== endId) continue;
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
  return { nodeIds, totalDist: dist[endId] };
}

function yenKSP(graph, startId, endId, K) {
  K = K || 3;
  const first = dijkstra(graph, startId, endId);
  if (!first) return [];
  const kPaths     = [first];
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
          const ek = [kp.nodeIds[i], kp.nodeIds[i + 1]].sort().join('|');
          blockedEdges.add(ek);
        }
      }
      for (const n of rootPath.slice(0, -1)) blockedNodes.add(n);
      const spurResult = dijkstra(graph, spurNode, endId, blockedEdges, blockedNodes);
      if (!spurResult) continue;
      let rootDist = 0;
      for (let j = 0; j < rootPath.length - 1; j++) {
        const a = rootPath[j];
        const b = rootPath[j + 1];
        const edge = (graph[a] || []).find(e => e.to === b);
        if (edge) rootDist += edge.dist;
      }
      const totalNodeIds = [...rootPath, ...spurResult.nodeIds.slice(1)];
      const totalDist    = rootDist + spurResult.totalDist;
      const pathKey      = totalNodeIds.join('->');
      const isDup =
        kPaths.some(p => p.nodeIds.join('->') === pathKey) ||
        candidates.some(c => c.nodeIds.join('->') === pathKey);
      if (!isDup) candidates.push({ nodeIds: totalNodeIds, totalDist });
    }
    if (candidates.length === 0) break;
    candidates.sort((a, b) => a.totalDist - b.totalDist);
    kPaths.push(candidates.shift());
  }
  return kPaths;
}

// ═══════════════════════════════════════════════════════════════════════════
// ROUTE SCORING
// score = distance + timePenalty(seconds) + crowdPenalty
// ═══════════════════════════════════════════════════════════════════════════
function scoreRoute(route, statusMap) {
  const CROWD_PENALTY  = { low: 0, medium: 20, high: 50 };
  const WALK_SPEED_KMH = 5;

  const { nodeIds, totalDist } = route;
  let totalCrowdPenalty = 0;
  let hasBlocked        = false;
  const crowdCounts     = { low: 0, medium: 0, high: 0 };

  for (let i = 0; i < nodeIds.length - 1; i++) {
    const edgeKey = [nodeIds[i], nodeIds[i + 1]].sort().join('|');
    const status  = statusMap.get(edgeKey);
    if (status && status.blocked) hasBlocked = true;
    const level = (status && status.crowdLevel) ? status.crowdLevel : 'low';
    crowdCounts[level]++;
    totalCrowdPenalty += CROWD_PENALTY[level];
  }

  const dominantCrowd = Object.entries(crowdCounts)
    .sort((a, b) => b[1] - a[1])[0][0];

  // Speed drops with crowd
  const crowdSpeedFactor = dominantCrowd === 'high' ? 0.65
    : dominantCrowd === 'medium' ? 0.80 : 1.0;
  const effectiveSpeed = WALK_SPEED_KMH * crowdSpeedFactor;
  const timeMin = (totalDist / 1000 / effectiveSpeed) * 60;
  const timePenalty = timeMin * 60;
  const score = Math.round(totalDist + timePenalty + totalCrowdPenalty);

  const crowdSummary = dominantCrowd === 'high' ? 'High'
    : dominantCrowd === 'medium' ? 'Medium' : 'Low';

  return {
    nodes:        nodeIds,
    distance:     Math.round(totalDist),
    time:         Math.round(timeMin * 10) / 10,
    crowdSummary,
    crowdCounts,
    blocked:      hasBlocked,
    score,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/routes/optimal
// Body: { source, destination, k? }
// source/destination can be building names OR node IDs (N1, N42…)
// ═══════════════════════════════════════════════════════════════════════════
router.post('/optimal', async (req, res) => {
  try {
    const { source, destination, k = 3 } = req.body;

    if (!source || !destination) {
      return res.status(400).json({ error: 'source and destination are required.' });
    }
    if (source === destination) {
      return res.status(400).json({ error: 'Source and destination cannot be the same.' });
    }

    const buildings  = getBuildingIndex();
    const sourceNode = resolveBuildingToNode(source, buildings);
    const destNode   = resolveBuildingToNode(destination, buildings);

    if (!sourceNode) {
      return res.status(404).json({ error: `Could not resolve source "${source}" to a road node.` });
    }
    if (!destNode) {
      return res.status(404).json({ error: `Could not resolve destination "${destination}" to a road node.` });
    }

    const [roads, statusMap] = await Promise.all([
      Road.find({}).lean(),
      RoadStatus.getStatusMap(),
    ]);

    const graph = buildGraph(roads, statusMap);

    if (!graph[sourceNode]) {
      return res.status(404).json({ error: `Source node "${sourceNode}" not found in road network.` });
    }
    if (!graph[destNode]) {
      return res.status(404).json({ error: `Destination node "${destNode}" not found in road network.` });
    }

    const rawPaths = yenKSP(graph, sourceNode, destNode, Math.min(k, 5));

    if (rawPaths.length === 0) {
      return res.status(200).json({
        message: 'No valid route found. All paths may be blocked.',
        routes: [],
        recommendedIndex: null,
        source,
        destination,
      });
    }

    // Score all routes; filter out blocked ones (per spec)
    let scoredRoutes = rawPaths
      .map(p => scoreRoute(p, statusMap))
      .filter(r => !r.blocked);

    // If everything is blocked, show them anyway with blocked=true
    if (scoredRoutes.length === 0) {
      scoredRoutes = rawPaths.map(p => scoreRoute(p, statusMap));
    }

    scoredRoutes.sort((a, b) => a.score - b.score);

    res.json({
      source,
      destination,
      sourceNode,
      destNode,
      recommendedIndex: 0,
      routes: scoredRoutes,
    });

  } catch (err) {
    console.error('Optimal route error:', err);
    res.status(500).json({ error: 'Failed to compute optimal route.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/routes/road-status
// ═══════════════════════════════════════════════════════════════════════════
router.get('/road-status', async (req, res) => {
  try {
    const [roads, allStatuses] = await Promise.all([
      Road.find({}).lean(),
      RoadStatus.find({}).lean(),
    ]);

    const statusMap = new Map();
    for (const s of allStatuses) statusMap.set(s.edgeKey, s);

    // Start with all Road collection entries
    const segmentMap = new Map();
    for (const road of roads) {
      const status = statusMap.get(road.edgeKey);
      segmentMap.set(road.edgeKey, {
        fromNode:   road.fromNode,
        toNode:     road.toNode,
        edgeKey:    road.edgeKey,
        blocked:    status ? status.blocked    : false,
        crowdLevel: status ? status.crowdLevel : 'low',
      });
    }

    // Also include any RoadStatus entries whose edgeKey is NOT in Road collection.
    // This ensures crowd data set by admin is always returned even if the Road
    // document uses a different node-ID scheme than the frontend's GeoJSON graph.
    for (const s of allStatuses) {
      if (!segmentMap.has(s.edgeKey)) {
        segmentMap.set(s.edgeKey, {
          fromNode:   s.fromNode,
          toNode:     s.toNode,
          edgeKey:    s.edgeKey,
          blocked:    s.blocked,
          crowdLevel: s.crowdLevel,
        });
      }
    }

    const segments = [...segmentMap.values()];
    res.json({ total: segments.length, segments });
  } catch (err) {
    console.error('Public road-status error:', err);
    res.status(500).json({ error: 'Failed to fetch road statuses.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/routes/nodes
// ═══════════════════════════════════════════════════════════════════════════
router.get('/nodes', async (req, res) => {
  try {
    const roads = await Road.find({}).lean();
    const nodeSet = new Set();
    for (const r of roads) { nodeSet.add(r.fromNode); nodeSet.add(r.toNode); }
    res.json({ nodes: [...nodeSet].sort() });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch nodes.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/routes/buildings — building names for UI dropdowns
// ═══════════════════════════════════════════════════════════════════════════
router.get('/buildings', (req, res) => {
  try {
    const buildings = getBuildingIndex();
    res.json({ buildings: buildings.map(b => ({ name: b.name, snap: b.snap })) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch building list.' });
  }
});

module.exports = router;