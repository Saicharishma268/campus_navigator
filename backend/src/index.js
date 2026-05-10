require('dotenv').config();

const express   = require('express');
const cors      = require('cors');
const connectDB = require('./config/db');
const Road      = require('./models/Road');
const AdminUser = require('./models/AdminUser');

const adminRoutes = require('./routes/admin');
const routeRoutes = require('./routes/routes');
const chatRoutes  = require('./routes/chat');

const app = express();

app.use(cors({ origin: process.env.CLIENT_ORIGIN || '*' }));
app.use(express.json());

app.use('/api/admin',  adminRoutes);
app.use('/api/routes', routeRoutes);
app.use('/api/chat',   chatRoutes);
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

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

async function seedRoadsFromGeoJson() {
  const fs   = require('fs');
  const path = require('path');

  // ⚠️ Update this path to where your map.geojson is
  const geoJsonPath = path.resolve(__dirname, '../../frontend/src/data/map.geojson');

  if (!fs.existsSync(geoJsonPath)) {
    console.warn('⚠️  map.geojson not found at', geoJsonPath, '— skipping road seed.');
    return;
  }

  const existing = await Road.countDocuments();
  if (existing > 0) {
    console.log(`ℹ️  Roads already seeded (${existing} segments). Skipping.`);
    return;
  }

  const raw    = fs.readFileSync(geoJsonPath, 'utf8');
  const geoJson = JSON.parse(raw);

  const lineFeatures = (geoJson.features || []).filter(
    (f) => f?.geometry?.type === 'LineString',
  );

  const nodeIdByKey = new Map();
  const ROAD_NODES  = {};
  const edgeSet     = new Set();
  let nodeCount = 1;

  function toLatLng(coord) { return [coord[1], coord[0]]; }

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
    for (let i = 0; i < coords.length - 1; i++) {
      const [lat1, lng1] = toLatLng(coords[i]);
      const [lat2, lng2] = toLatLng(coords[i + 1]);
      const a = getNodeId(lat1, lng1);
      const b = getNodeId(lat2, lng2);
      edgeSet.add([a, b].sort().join('|'));
    }
  }

  const entries = Object.entries(ROAD_NODES);
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const [idA, coordA] = entries[i];
      const [idB, coordB] = entries[j];
      if (haversine(coordA, coordB) <= 22) {
        edgeSet.add([idA, idB].sort().join('|'));
      }
    }
  }

  const docs = [...edgeSet].map((edgeKey) => {
    const [a, b] = edgeKey.split('|');
    const dist = ROAD_NODES[a] && ROAD_NODES[b]
      ? haversine(ROAD_NODES[a], ROAD_NODES[b])
      : 0;
    return { fromNode: a, toNode: b, distance: Math.round(dist), edgeKey };
  });

  await Road.insertMany(docs, { ordered: false });
  console.log(`✅ Seeded ${docs.length} road segments into MongoDB.`);
}

async function seedDefaultAdmin() {
  const exists = await AdminUser.findOne({ username: 'admin' });
  if (exists) return;
  const user = new AdminUser({ username: 'admin', role: 'superadmin' });
  await user.setPassword('campus@123');
  await user.save();
  console.log('✅ Default admin created  username: admin  password: campus@123');
}

(async () => {
  await connectDB();
  await seedRoadsFromGeoJson();
  await seedDefaultAdmin();

  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });
})();