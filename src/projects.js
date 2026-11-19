'use strict';
const { randomUUID } = require('crypto');
const { getDb } = require('./db');
const { auditLog } = require('./audit');

function _parse(p) {
  if (!p) return null;
  p.tags = JSON.parse(p.tags || '[]');
  return p;
}

function create(opts) {
  const { name, objective, description, domain, status = 'active', tags = [] } = opts;
  if (!name?.trim()) throw new Error('name is required');

  const db = getDb();
  const id = randomUUID();
  const now = Date.now();
  db.prepare(`
    INSERT INTO projects (id, name, objective, description, status, domain, created_at, updated_at, tags)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, objective || null, description || null, status,
         domain || null, now, now, JSON.stringify(tags));

  auditLog('CREATE', 'project', id, { name });
  return get(id);
}

function get(id) {
  return _parse(getDb().prepare('SELECT * FROM projects WHERE id = ?').get(id));
}

function list({ status, domain, limit = 20 } = {}) {
  let sql = 'SELECT * FROM projects WHERE 1=1';
  const params = [];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (domain) { sql += ' AND domain = ?'; params.push(domain); }
  sql += ' ORDER BY updated_at DESC LIMIT ?';
  params.push(limit);
  return getDb().prepare(sql).all(...params).map(_parse);
}

function update(id, updates) {
  const existing = get(id);
  if (!existing) throw new Error(`Project not found: ${id}`);

  const ALLOWED = ['name', 'objective', 'description', 'status', 'domain', 'tags'];
  const setClauses = [], values = [];
  for (const [k, v] of Object.entries(updates)) {
    if (!ALLOWED.includes(k)) continue;
    setClauses.push(`${k} = ?`);
    values.push(k === 'tags' ? JSON.stringify(v) : v);
  }
  if (!setClauses.length) return existing;
  setClauses.push('updated_at = ?');
  values.push(Date.now(), id);
  getDb().prepare(`UPDATE projects SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
  auditLog('UPDATE', 'project', id, Object.keys(updates));
  return get(id);
}

module.exports = { create, get, list, update };
