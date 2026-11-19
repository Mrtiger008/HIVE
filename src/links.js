'use strict';
const { randomUUID } = require('crypto');
const { getDb } = require('./db');

const VALID_TYPES = ['related', 'supports', 'contradicts', 'supersedes', 'predecessor', 'see-also'];

function add(fromId, relType, toId, notes = null) {
  if (!fromId || !toId) throw new Error('fromId and toId are required');
  const type = (relType || 'related').toLowerCase();
  if (!VALID_TYPES.includes(type)) throw new Error(`rel_type must be one of: ${VALID_TYPES.join(', ')}`);
  const db = getDb();
  if (!db.prepare('SELECT id FROM memories WHERE id=?').get(fromId))
    throw new Error(`Memory not found: ${fromId}`);
  if (!db.prepare('SELECT id FROM memories WHERE id=?').get(toId))
    throw new Error(`Memory not found: ${toId}`);
  const id = randomUUID();
  db.prepare(
    'INSERT INTO relationships (id, from_id, rel_type, to_id, confidence, notes, created_at) VALUES (?,?,?,?,?,?,?)'
  ).run(id, fromId, type, toId, 1.0, notes, Date.now());
  return { id, from_id: fromId, rel_type: type, to_id: toId, notes, created_at: Date.now() };
}

function list(memoryId) {
  const db = getDb();
  // Returns links where this memory is either side, joining title of the other memory
  const out = db.prepare(`
    SELECT r.id, r.from_id, r.rel_type, r.to_id, r.notes, r.created_at,
           mf.title as from_title, mt.title as to_title
    FROM relationships r
    LEFT JOIN memories mf ON mf.id = r.from_id
    LEFT JOIN memories mt ON mt.id = r.to_id
    WHERE (r.from_id=? OR r.to_id=?)
      AND (mf.id IS NULL OR mf.status='active' OR mf.id != ?)
    ORDER BY r.created_at DESC
  `).all(memoryId, memoryId, memoryId);
  // Only return rows that look like memory-to-memory (UUIDs, not entity rows)
  return out.filter(r => r.from_title !== undefined || r.to_title !== undefined);
}

function remove(id) {
  return getDb().prepare('DELETE FROM relationships WHERE id=?').run(id).changes;
}

module.exports = { add, list, remove, VALID_TYPES };
