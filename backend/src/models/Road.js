const mongoose = require('mongoose');

const roadSchema = new mongoose.Schema(
  {
    fromNode: { type: String, required: true, trim: true },
    toNode:   { type: String, required: true, trim: true },
    distance: { type: Number, required: true, min: 0 },
    edgeKey:  { type: String, required: true, unique: true, index: true },
  },
  { timestamps: true },
);

roadSchema.statics.makeEdgeKey = function (a, b) {
  return [a, b].sort().join('|');
};

module.exports = mongoose.model('Road', roadSchema);