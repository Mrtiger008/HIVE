'use strict';
const { randomUUID } = require('crypto');
const { getDb } = require('./db');
const { auditLog } = require('./audit');
const { scanForSecrets } = require('./security');
const { syncToMarkdown } = require('./export');

const VALID_TYPES  = ['core', 'domain', 'project', 'episodic', 'semantic', 'skill'];
const VALID_TRUST  = ['USER_CONFIRMED', 'SOURCE_VERIFIED', 'OBSERVED', 'INFERRED',
                      'AI_HYPOTHESIS', 'CONFLICTED', 'OUTDATED', 'UNKNOWN'];

function _parse(m) {
  if (!m) return null;
  m.tags = JSON.parse(m.tags || '[]');
  return m;
}

function add(opts) {
  const {
    title, content,
    memory_type = 'semantic',
    domain, project_id,
    source, source_type, source_ref,
    confidence = 0.5,
    trust_level = 'OBSERVED',
    status = 'active',
    importance = 5,
    tags = [],
    valid_from, valid_until,
    supersedes,
    retrieval_keywords,
    label,
    note,
    expires_at,
  } = opts;

  if (!title?.trim())   throw new Error('title is required');
  if (!content?.trim()) throw new Error('content is required');
  if (!VALID_TYPES.includes(memory_type))
    throw new Error(`memory_type must be one of: ${VALID_TYPES.join(', ')}`);
  if (!VALID_TRUST.includes(trust_level))
    throw new Error(`trust_level must be one of: ${VALID_TRUST.join(', ')}`);

  const hit = scanForSecrets(`${title} ${content}`);
  if (hit) throw new Error(`Secret detected (${hit}). Do not store credentials in HIVE.`);

  const db = getDb();
  const id = randomUUID();
  const now = Date.now();

  db.prepare(`
    INSERT INTO memories
      (id, title, content, memory_type, domain, project_id,
       created_at, updated_at, source, source_type, source_ref,
       confidence, trust_level, status, importance, tags,
       valid_from, valid_until, supersedes, retrieval_keywords, label, note, expires_at)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, title, content, memory_type,
    domain || null, project_id || null,
    now, now,
    source || null, source_type || null, source_ref || null,
    confidence, trust_level, status, importance,
    JSON.stringify(tags),
    valid_from || null, valid_until || null,
    supersedes || null,
    retrieval_keywords || null,
    label || null,
    note || null,
    expires_at || null,
  );

  if (supersedes) {
    db.prepare("UPDATE memories SET superseded_by = ?, status = 'superseded', updated_at = ? WHERE id = ?")
      .run(id, now, supersedes);
  }

  auditLog('CREATE', 'memory', id, { title, trust_level, source_type: source_type || null });

  const m = get(id);
  syncToMarkdown(m);
  // Auto-extract entity mentions — soft dependency, never blocks the add
  try { require('./extract').extractAndLink(id, { title, content }); } catch {}
  // Auto-embed for semantic search — fire-and-forget, never blocks the add
  try { require('./semantic').embedMemory(m).catch(() => {}); } catch {}
  return m;
}

function get(id) {
  return _parse(getDb().prepare('SELECT * FROM memories WHERE id = ?').get(id));
}

function update(id, updates) {
  const existing = get(id);
  if (!existing) throw new Error(`Memory not found: ${id}`);

  const contentCheck = `${updates.title || ''} ${updates.content || ''}`.trim();
  if (contentCheck) {
    const hit = scanForSecrets(contentCheck);
    if (hit) throw new Error(`Secret detected (${hit}).`);
  }

  const ALLOWED = ['title', 'content', 'memory_type', 'domain', 'project_id', 'confidence',
                   'trust_level', 'status', 'importance', 'tags', 'valid_until', 'superseded_by',
                   'retrieval_keywords', 'user_confirmed', 'pinned', 'label', 'note', 'expires_at', 'starred', 'read_at', 'needs_review'];
  const setClauses = [], values = [];
  for (const [k, v] of Object.entries(updates)) {
    if (!ALLOWED.includes(k)) continue;
    setClauses.push(`${k} = ?`);
    values.push(k === 'tags' ? JSON.stringify(v) : v);
  }
  if (!setClauses.length) return existing;

  setClauses.push('updated_at = ?');
  values.push(Date.now(), id);
  getDb().prepare(`UPDATE memories SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
  auditLog('UPDATE', 'memory', id, Object.keys(updates));

  const m = get(id);
  syncToMarkdown(m);
  return m;
}

function remove(id) {
  const existing = get(id);
  if (!existing) throw new Error(`Memory not found: ${id}`);
  getDb().prepare('DELETE FROM memories WHERE id = ?').run(id);
  auditLog('DELETE', 'memory', id, { title: existing.title });
  return true;
}

const SORT_MAP = {
  updated:    'pinned DESC, updated_at DESC',
  created:    'pinned DESC, created_at DESC',
  importance: 'pinned DESC, importance DESC, updated_at DESC',
  confidence: 'pinned DESC, confidence DESC, updated_at DESC',
  label:      "pinned DESC, CASE label WHEN 'red' THEN 0 WHEN 'yellow' THEN 1 WHEN 'green' THEN 2 WHEN 'blue' THEN 3 ELSE 4 END, updated_at DESC",
  starred:    'starred DESC, pinned DESC, updated_at DESC',
};

function list({ type, domain, project_id, trust_level, status = 'active', limit = 20, offset = 0, min_conf, max_conf, min_importance, created_after, created_before, sort, flagged, sort_dir = 'desc' } = {}) {
  let sql = 'SELECT * FROM memories WHERE 1=1';
  const params = [];
  if (type)           { sql += ' AND memory_type = ?';   params.push(type); }
  if (domain)         { sql += ' AND domain = ?';         params.push(domain); }
  if (project_id)     { sql += ' AND project_id = ?';     params.push(project_id); }
  if (trust_level)    { sql += ' AND trust_level = ?';    params.push(trust_level); }
  if (status)         { sql += ' AND status = ?';         params.push(status); }
  if (min_conf != null)        { sql += ' AND confidence >= ?';  params.push(min_conf); }
  if (max_conf != null)        { sql += ' AND confidence <= ?';  params.push(max_conf); }
  if (min_importance != null)  { sql += ' AND importance >= ?';  params.push(min_importance); }
  if (created_after != null)   { sql += ' AND created_at >= ?';  params.push(created_after); }
  if (created_before != null)  { sql += ' AND created_at < ?';   params.push(created_before); }
  if (flagged)                 { sql += ' AND needs_review = 1'; }
  const rawOrder = SORT_MAP[sort] || SORT_MAP.updated;
  const order = sort_dir === 'asc'
    ? rawOrder.replace(/\b(updated_at|created_at|importance|confidence|END) DESC/g, '$1 ASC')
    : rawOrder;
  sql += ` ORDER BY ${order} LIMIT ? OFFSET ?`;
  params.push(limit, offset);
  return getDb().prepare(sql).all(...params).map(_parse);
}

module.exports = { add, get, update, remove, list };
