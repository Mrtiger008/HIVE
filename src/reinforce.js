'use strict';
const { getDb } = require('./db');

// Bump importance by 1 (capped at 10) and record access time.
function reinforce(id) {
  const now = Date.now();
  getDb().prepare(`
    UPDATE memories SET importance = MIN(10, importance + 1), last_accessed_at = ?, updated_at = ? WHERE id = ?
  `).run(now, now, id);
  return getDb().prepare('SELECT id, importance, last_accessed_at FROM memories WHERE id = ?').get(id);
}

// Record access without changing importance.
function touch(id) {
  getDb().prepare('UPDATE memories SET last_accessed_at = ? WHERE id = ?').run(Date.now(), id);
}

module.exports = { reinforce, touch };
