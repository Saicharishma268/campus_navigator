// src/models/RoadStatus.js
//
// One document per road segment storing the live security-controlled state.
// Created automatically when a segment is first updated by admin.
// Queried by the route-optimiser at request time.
//
const mongoose = require('mongoose');

const CROWD_LEVELS = ['low', 'medium', 'high'];

// Crowd penalty (seconds added to travel time per metre — treated as a flat
// penalty in the scoring formula rather than per-metre so short alleys and
// long roads are penalised equally for crowd density)
const CROWD_PENALTY = { low: 0, medium: 20, high: 50 };

const roadStatusSchema = new mongoose.Schema(
  {
    // Mirror Road.edgeKey so joins are trivial
    edgeKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    fromNode: { type: String, required: true, trim: true },
    toNode:   { type: String, required: true, trim: true },

    blocked: {
      type: Boolean,
      default: false,
    },
    crowdLevel: {
      type: String,
      enum: CROWD_LEVELS,
      default: 'low',
    },
    remarks: {
      type: String,
      default: '',
      maxlength: 500,
    },
    updatedBy: {
      type: String,   // admin username for audit trail
      default: 'system',
    },
  },
  { timestamps: true },
);

// Static helpers used by the route-optimiser
roadStatusSchema.statics.CROWD_LEVELS  = CROWD_LEVELS;
roadStatusSchema.statics.CROWD_PENALTY = CROWD_PENALTY;

roadStatusSchema.statics.makeEdgeKey = function (a, b) {
  return [a, b].sort().join('|');
};

// Returns a Map<edgeKey, RoadStatus> for fast lookup during scoring
roadStatusSchema.statics.getStatusMap = async function () {
  const all = await this.find({});
  const map = new Map();
  for (const s of all) map.set(s.edgeKey, s);
  return map;
};

module.exports = mongoose.model('RoadStatus', roadStatusSchema);