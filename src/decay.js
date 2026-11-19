'use strict';
const { getDb } = require('./db');

const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;

// Decay rate: 1% per week idle, halved for high-importance (>=7) or pinned memories.
// Min confidence floor: 0.1. Only active memories decay.
function _decayFactor(idleMs, importance, pinned) {
  const weeks = idleMs / WEEK;
  const rate = (importance >= 7 || pinned) ? 0.005 : 0.01; // per week
  return Math.max(0, 1 - rate * weeks);
}

function preview(opts = {}) {
  const { minIdleDays = 14 } = opts;
  const db = getDb();
  const now = Date.now();
  const cutoff = now - minIdleDays * DAY;

  const rows = db.prepare(`
    SELECT id, title, memory_type, confidence, importance, pinned,
           last_accessed_at, created_at
    FROM memories WHERE status = 'active' AND confidence > 0.1
  `).all();

  return rows
    .map(m => {
      const lastSeen = m.last_accessed_at || m.created_at;
      const idleMs = now - lastSeen;
      if (lastSeen > cutoff) return null; // recently active — skip
      const factor = _decayFactor(idleMs, m.importance, m.pinned);
      const newConf = Math.max(0.1, +(m.confidence * factor).toFixed(3));
      if (newConf >= m.confidence) return null; // no change
      return {
        id: m.id, title: m.title, memory_type: m.memory_type,
        confidence: m.confidence, new_confidence: newConf,
        idle_days: Math.round(idleMs / DAY),
        importance: m.importance, pinned: m.pinned,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.idle_days - a.idle_days);
}

function run(opts = {}) {
  const changes = preview(opts);
  if (!changes.length) return { applied: 0, changes };
  const db = getDb();
  const stmt = db.prepare('UPDATE memories SET confidence = ?, updated_at = ? WHERE id = ?');
  const now = Date.now();
  const apply = db.transaction(() => {
    for (const c of changes) stmt.run(c.new_confidence, now, c.id);
  });
  apply();
  return { applied: changes.length, changes };
}

// Kept for handleReview compatibility — returns active memories sorted by staleness
function stalest({ projectId = null, limit = 20 } = {}) {
  const db = getDb();
  let sql = "SELECT * FROM memories WHERE status = 'active'";
  const params = [];
  if (projectId) { sql += ' AND project_id = ?'; params.push(projectId); }
  sql += ' ORDER BY COALESCE(last_accessed_at, created_at) ASC LIMIT ?';
  params.push(limit);
  const rows = db.prepare(sql).all(...params);
  return rows.map(m => { try { m.tags = JSON.parse(m.tags || '[]'); } catch {} return m; });
}

module.exports = { preview, run, stalest };
