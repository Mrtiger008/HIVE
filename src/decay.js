'use strict';
const { getDb } = require('./db');

const MS_PER_DAY = 86400000;
const HALF_LIFE_DAYS = 30; // score halves after 30 idle days

function decayScore(memory) {
  const now = Date.now();
  const lastAccess = memory.last_accessed_at || memory.created_at || now;
  const days = Math.max(0, (now - lastAccess) / MS_PER_DAY);
  return memory.importance / (1 + days / HALF_LIFE_DAYS);
}

// Mark active memories not accessed in 90+ days as OUTDATED; skip USER_CONFIRMED.
function sweep() {
  const { changes } = getDb().prepare(`
    UPDATE memories
    SET trust_level = 'OUTDATED', updated_at = ?
    WHERE status = 'active'
      AND trust_level NOT IN ('OUTDATED', 'USER_CONFIRMED')
      AND COALESCE(last_accessed_at, created_at) < ?
  `).run(Date.now(), Date.now() - 90 * MS_PER_DAY);
  return changes;
}

// Return memories sorted by decay score ascending (stalest first).
function stalest({ projectId, limit = 10 } = {}) {
  const now = Date.now();
  const halfLifeMs = HALF_LIFE_DAYS * MS_PER_DAY;
  let sql = `SELECT * FROM memories WHERE status = 'active'`;
  const params = [];
  if (projectId) { sql += ' AND project_id = ?'; params.push(projectId); }
  sql += ` ORDER BY (importance * 1.0 / (1.0 + (? - COALESCE(last_accessed_at, created_at)) * 1.0 / ?)) ASC LIMIT ?`;
  params.push(now, halfLifeMs, limit);
  return getDb().prepare(sql).all(...params).map(m => ({
    ...m,
    tags: JSON.parse(m.tags || '[]'),
    decay_score: decayScore(m),
  }));
}

module.exports = { decayScore, sweep, stalest, HALF_LIFE_DAYS };
