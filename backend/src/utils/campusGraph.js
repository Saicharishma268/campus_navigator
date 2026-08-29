// src/utils/campusGraph.js
//
// Shared GeoJSON / building-index helpers.
// Extracted out of routes.js so any part of the backend (routes.js, chat.js, …)
// can read the building list and road-node graph WITHOUT making an HTTP call
// back into the server. Previously chat.js did:
//     fetch(`http://localhost:${PORT}/api/routes/buildings`)
// on almost every chat message — a full network round trip (DNS/loopback,
// TCP, the whole Express middleware stack, JSON serialize/parse) just to get
// data that lives in this same process. That was one of the main sources of
// chatbot latency. Now everything shares one in-memory cache.
//
const path = require('path');
const fs   = require('fs');

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

// Cache the derived building index itself (not just the raw geojson) since
// it's recomputed from scratch every call otherwise.
let _buildingIndexCache = null;

function getBuildingIndex({ forceRefresh = false } = {}) {
  if (_buildingIndexCache && !forceRefresh) return _buildingIndexCache;

  const geoJson = loadGeoJson();
  if (!geoJson) return [];
  const ROAD_NODES = buildRoadNodesFromGeoJson(geoJson);
  const pointFeatures = (geoJson.features || []).filter(
    f => f && f.geometry && f.geometry.type === 'Point'
  );
  _buildingIndexCache = pointFeatures.map((f, idx) => {
    const [lat, lng] = toLatLng(f.geometry.coordinates);
    const name = cleanName(f.properties, `Location ${idx + 1}`);
    const snap = findNearestRoadNode([lat, lng], ROAD_NODES);
    return { name, lat, lng, snap };
  });
  return _buildingIndexCache;
}

function resolveBuildingToNode(nameOrNodeId, buildings) {
  if (/^N\d+$/.test(nameOrNodeId)) return nameOrNodeId;
  const lower = nameOrNodeId.toLowerCase();
  const match = buildings.find(b => b.name.toLowerCase() === lower);
  return match ? match.snap : null;
}

module.exports = {
  toLatLng,
  cleanName,
  haversine,
  loadGeoJson,
  buildRoadNodesFromGeoJson,
  findNearestRoadNode,
  getBuildingIndex,
  resolveBuildingToNode,
};