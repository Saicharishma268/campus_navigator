// src/routes/admin.js
const express    = require('express');
const jwt        = require('jsonwebtoken');
const AdminUser  = require('../models/AdminUser');
const Road       = require('../models/Road');
const RoadStatus = require('../models/RoadStatus');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/admin/login
// ═══════════════════════════════════════════════════════════════════════════
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: 'Username and password are required.' });

    const admin = await AdminUser.findOne({ username: username.toLowerCase().trim() });
    if (!admin) return res.status(401).json({ error: 'Invalid credentials.' });

    const valid = await admin.verifyPassword(password);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials.' });

    const token = jwt.sign(
      { id: admin._id, username: admin.username, role: admin.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' },
    );

    res.json({ token, admin: { username: admin.username, role: admin.role } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error during login.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/admin/me
// ═══════════════════════════════════════════════════════════════════════════
router.get('/me', requireAuth, async (req, res) => {
  try {
    const admin = await AdminUser.findById(req.admin.id);
    if (!admin) return res.status(404).json({ error: 'Admin not found.' });
    res.json(admin);
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/admin/road-status
// ═══════════════════════════════════════════════════════════════════════════
router.get('/road-status', requireAuth, async (req, res) => {
  try {
    const roads = await Road.find({}).lean();
    const statusMap = await RoadStatus.getStatusMap();
    const merged = roads.map((road) => {
      const status = statusMap.get(road.edgeKey);
      return {
        fromNode:   road.fromNode,
        toNode:     road.toNode,
        distance:   road.distance,
        edgeKey:    road.edgeKey,
        blocked:    status ? status.blocked    : false,
        crowdLevel: status ? status.crowdLevel : 'low',
        remarks:    status ? status.remarks    : '',
        updatedBy:  status ? status.updatedBy  : null,
        updatedAt:  status ? status.updatedAt  : null,
      };
    });
    res.json({ total: merged.length, segments: merged });
  } catch (err) {
    console.error('Get road-status error:', err);
    res.status(500).json({ error: 'Failed to fetch road statuses.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/admin/road-status/:edgeKey
// ═══════════════════════════════════════════════════════════════════════════
router.get('/road-status/:edgeKey', requireAuth, async (req, res) => {
  try {
    const edgeKey = decodeURIComponent(req.params.edgeKey);
    const road = await Road.findOne({ edgeKey }).lean();
    if (!road) return res.status(404).json({ error: `Road segment "${edgeKey}" not found.` });
    const status = await RoadStatus.findOne({ edgeKey }).lean();
    res.json({
      fromNode:   road.fromNode,
      toNode:     road.toNode,
      distance:   road.distance,
      edgeKey:    road.edgeKey,
      blocked:    status ? status.blocked    : false,
      crowdLevel: status ? status.crowdLevel : 'low',
      remarks:    status ? status.remarks    : '',
      updatedBy:  status ? status.updatedBy  : null,
      updatedAt:  status ? status.updatedAt  : null,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch road status.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/admin/road-status
// ═══════════════════════════════════════════════════════════════════════════
router.post('/road-status', requireAuth, async (req, res) => {
  try {
    const { edgeKey, blocked, crowdLevel, remarks } = req.body;
    if (!edgeKey) return res.status(400).json({ error: 'edgeKey is required.' });

    const road = await Road.findOne({ edgeKey });
    if (!road) return res.status(404).json({ error: `Road segment "${edgeKey}" not found.` });

    const existing = await RoadStatus.findOne({ edgeKey });
    if (existing) return res.status(409).json({ error: 'Status already exists. Use PUT to update.' });

    const status = await RoadStatus.create({
      edgeKey,
      fromNode:   road.fromNode,
      toNode:     road.toNode,
      blocked:    blocked    ?? false,
      crowdLevel: crowdLevel ?? 'low',
      remarks:    remarks    ?? '',
      updatedBy:  req.admin.username,
    });

    res.status(201).json({ message: 'Road status created.', status });
  } catch (err) {
    console.error('POST road-status error:', err);
    res.status(500).json({ error: 'Failed to create road status.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PUT /api/admin/road-status/:edgeKey
// ═══════════════════════════════════════════════════════════════════════════
router.put('/road-status/:edgeKey', requireAuth, async (req, res) => {
  try {
    const edgeKey = decodeURIComponent(req.params.edgeKey);
    const { blocked, crowdLevel, remarks } = req.body;

    const validLevels = ['low', 'medium', 'high'];
    if (crowdLevel && !validLevels.includes(crowdLevel))
      return res.status(400).json({ error: `Invalid crowdLevel. Must be: ${validLevels.join(', ')}` });

    const road = await Road.findOne({ edgeKey });
    if (!road) return res.status(404).json({ error: `Road segment "${edgeKey}" not found.` });

    const update = { fromNode: road.fromNode, toNode: road.toNode, updatedBy: req.admin.username };
    if (blocked    !== undefined) update.blocked    = blocked;
    if (crowdLevel !== undefined) update.crowdLevel = crowdLevel;
    if (remarks    !== undefined) update.remarks    = remarks;

    const status = await RoadStatus.findOneAndUpdate(
      { edgeKey },
      { $set: update },
      { new: true, upsert: true, runValidators: true },
    );

    res.json({ message: 'Road status updated.', status });
  } catch (err) {
    console.error('PUT road-status error:', err);
    res.status(500).json({ error: 'Failed to update road status.' });
  }
});

module.exports = router;