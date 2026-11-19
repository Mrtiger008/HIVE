'use strict';
const { randomUUID } = require('crypto');
const { getDb } = require('./db');
const { search } = require('./search');

function _parseRel(r) {
  return r || null;
}

function link({ from_id, rel_type, to_id, confidence = 0.5, notes, valid_from, valid_until }) {
  if (!from_id) throw new Error('from_id is required');
  if (!rel_type) throw new Error('rel_type is required');
  if (!to_id)   throw new Error('to_id is required');
  const db = getDb();
  // Verify both entities exist
  if (!db.prepare('SELECT id FROM entities WHERE id = ?').get(from_id))
    throw new Error(`Entity not found: ${from_id}`);
  if (!db.prepare('SELECT id FROM entities WHERE id = ?').get(to_id))
    throw new Error(`Entity not found: ${to_id}`);
  const id = randomUUID();
  db.prepare(`
    INSERT INTO relationships (id, from_id, rel_type, to_id, confidence, notes, valid_from, valid_until, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, from_id, rel_type.toUpperCase(), to_id, confidence,
         notes || null, valid_from || null, valid_until || null, Date.now());
  return getRelationship(id);
}

function unlink(id) {
  const db = getDb();
  const r = getRelationship(id);
  if (!r) throw new Error(`Relationship not found: ${id}`);
  db.prepare('DELETE FROM relationships WHERE id = ?').run(id);
}

function getRelationship(id) {
  return _parseRel(getDb().prepare('SELECT * FROM relationships WHERE id = ?').get(id));
}

// Returns adjacent entities with their connecting relationship metadata.
function neighbors(entityId, { direction = 'both', relType, limit = 20 } = {}) {
  const db = getDb();
  const typeFilter = relType ? `AND r.rel_type = ?` : '';
  const typeArgs   = relType ? [relType.toUpperCase()] : [];

  function query(fromCol, toCol, joinCol) {
    return db.prepare(`
      SELECT e.*, r.id AS rel_id, r.rel_type, r.confidence AS rel_confidence,
             r.notes AS rel_notes, '${fromCol === 'from_id' ? 'out' : 'in'}' AS direction
      FROM relationships r
      JOIN entities e ON r.${joinCol} = e.id
      WHERE r.${fromCol} = ? ${typeFilter}
      LIMIT ?
    `).all(entityId, ...typeArgs, limit);
  }

  let rows;
  if (direction === 'out') {
    rows = query('from_id', 'to_id', 'to_id');
  } else if (direction === 'in') {
    rows = query('to_id', 'from_id', 'from_id');
  } else {
    // Both: outgoing + incoming, deduplicated by rel_id
    const out = query('from_id', 'to_id', 'to_id');
    const inc = query('to_id',   'from_id', 'from_id');
    const seen = new Set();
    rows = [...out, ...inc].filter(r => { if (seen.has(r.rel_id)) return false; seen.add(r.rel_id); return true; });
  }

  return rows.map(r => {
    r.aliases = JSON.parse(r.aliases || '[]');
    return r;
  }).slice(0, limit);
}

// Memories whose content mentions the entity name or any of its aliases.
// Uses FTS5 for relevance; falls back to returning empty on error.
function relatedMemories(entityId, limit = 10) {
  const db = getDb();
  const e = db.prepare('SELECT * FROM entities WHERE id = ?').get(entityId);
  if (!e) throw new Error(`Entity not found: ${entityId}`);
  const aliases = JSON.parse(e.aliases || '[]');
  const terms = [e.name, ...aliases].filter(Boolean);
  if (!terms.length) return [];
  // Search using the entity name and aliases via FTS; return union ranked by relevance
  const seen = new Set();
  const results = [];
  for (const term of terms) {
    for (const m of search(term, { limit })) {
      if (!seen.has(m.id)) { seen.add(m.id); results.push(m); }
    }
    if (results.length >= limit) break;
  }
  return results.slice(0, limit);
}

module.exports = { link, unlink, getRelationship, neighbors, relatedMemories };
