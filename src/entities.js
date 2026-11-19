'use strict';
const { randomUUID } = require('crypto');
const { getDb } = require('./db');

const VALID_TYPES = ['person', 'tool', 'org', 'concept', 'project', 'file', 'domain', 'other'];

function _parse(e) {
  if (!e) return null;
  e.aliases = JSON.parse(e.aliases || '[]');
  return e;
}

function create({ name, entity_type = 'other', description, aliases = [] }) {
  if (!name?.trim()) throw new Error('name is required');
  if (!VALID_TYPES.includes(entity_type))
    throw new Error(`entity_type must be one of: ${VALID_TYPES.join(', ')}`);
  const db = getDb();
  const id = randomUUID();
  const now = Date.now();
  db.prepare(`
    INSERT INTO entities (id, name, entity_type, description, aliases, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, name.trim(), entity_type, description || null, JSON.stringify(aliases), now);
  return _parse(db.prepare('SELECT * FROM entities WHERE id = ?').get(id));
}

function get(id) {
  return _parse(getDb().prepare('SELECT * FROM entities WHERE id = ?').get(id));
}

function findByName(name) {
  if (!name?.trim()) return [];
  const db = getDb();
  const pattern = `%${name.trim().toLowerCase()}%`;
  // Match on name OR any value in the aliases JSON array
  const exact = name.trim().toLowerCase();
  return db.prepare(`
    SELECT e.* FROM entities e
    WHERE lower(e.name) LIKE ?
       OR EXISTS (
         SELECT 1 FROM json_each(e.aliases) WHERE lower(value) LIKE ?
       )
    ORDER BY CASE WHEN lower(e.name) = ? THEN 0 ELSE 1 END, e.created_at DESC
    LIMIT 20
  `).all(pattern, pattern, exact).map(_parse);
}

function list({ entity_type, limit = 50 } = {}) {
  const db = getDb();
  if (entity_type) {
    return db.prepare(`SELECT * FROM entities WHERE entity_type = ? ORDER BY created_at DESC LIMIT ?`)
      .all(entity_type, limit).map(_parse);
  }
  return db.prepare(`SELECT * FROM entities ORDER BY created_at DESC LIMIT ?`)
    .all(limit).map(_parse);
}

function update(id, updates) {
  const e = get(id);
  if (!e) throw new Error(`Entity not found: ${id}`);
  const allowed = ['name', 'entity_type', 'description', 'aliases'];
  const fields = Object.keys(updates).filter(k => allowed.includes(k) && updates[k] !== undefined);
  if (!fields.length) throw new Error('No valid fields to update');
  const setClause = fields.map(f => `${f} = ?`).join(', ');
  const values = fields.map(f => f === 'aliases' ? JSON.stringify(updates[f]) : updates[f]);
  getDb().prepare(`UPDATE entities SET ${setClause} WHERE id = ?`).run(...values, id);
  return get(id);
}

// Merge dropId into keepId: reroute all relationships, then delete the dropped entity.
function merge(keepId, dropId) {
  if (keepId === dropId) throw new Error('Cannot merge an entity with itself');
  const db = getDb();
  if (!get(keepId)) throw new Error(`Keep entity not found: ${keepId}`);
  if (!get(dropId)) throw new Error(`Drop entity not found: ${dropId}`);
  db.prepare('UPDATE relationships SET from_id = ? WHERE from_id = ?').run(keepId, dropId);
  db.prepare('UPDATE relationships SET to_id   = ? WHERE to_id   = ?').run(keepId, dropId);
  db.prepare('DELETE FROM entities WHERE id = ?').run(dropId);
  return get(keepId);
}

module.exports = { create, get, findByName, list, update, merge, VALID_TYPES };
