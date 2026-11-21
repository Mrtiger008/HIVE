'use strict';
const { getDb } = require('./db');
const { touch } = require('./reinforce');

// Full-text search over memories using SQLite FTS5 (BM25 ranking).
// Falls back to LIKE search if the FTS query has syntax errors.
function search(query, { domain, project_id, type, trust_level, status = 'active', limit = 10 } = {}) {
  if (!query?.trim()) return [];
  const db = getDb();

  // Build FTS5 query: join each word with OR so natural-language queries
  // ("why is my query double counting") match on any meaningful term.
  // BM25 then ranks by how many terms actually hit.
  const ftsQuery = query.trim()
    .split(/\s+/)
    .map(w => w.replace(/[^a-zA-Z0-9_-]/g, ''))
    .filter(w => w.length > 0)
    .join(' OR ');
  if (!ftsQuery) return [];

  // \x01 / \x02 are safe highlight delimiters — survive JSON and HTML-escaping on the client
  const HL_OPEN = '\x01', HL_CLOSE = '\x02';

  let sql = `
    SELECT m.*,
           bm25(memories_fts) AS _rank,
           highlight(memories_fts, 1, '${HL_OPEN}', '${HL_CLOSE}') AS highlight_title,
           snippet(memories_fts, 2, '${HL_OPEN}', '${HL_CLOSE}', '…', 24) AS snippet
    FROM memories_fts
    JOIN memories m ON memories_fts.id = m.id
    WHERE memories_fts MATCH ?
      AND m.status = ?
  `;
  const params = [ftsQuery, status];
  if (domain)      { sql += ' AND m.domain = ?';       params.push(domain); }
  if (project_id)  { sql += ' AND m.project_id = ?';   params.push(project_id); }
  if (type)        { sql += ' AND m.memory_type = ?';  params.push(type); }
  if (trust_level) { sql += ' AND m.trust_level = ?';  params.push(trust_level); }
  sql += ' ORDER BY _rank, m.importance DESC LIMIT ?';
  params.push(limit);

  try {
    const results = db.prepare(sql).all(...params).map(m => ({ ...m, tags: JSON.parse(m.tags || '[]') }));
    results.forEach(m => touch(m.id));

    // Supplement: pick up memories matched only by their note (not indexed in FTS5)
    const seenIds = new Set(results.map(m => m.id));
    const noteResults = _noteFallback(db, query, { domain, project_id, type, trust_level, status, limit }, seenIds);
    noteResults.forEach(m => touch(m.id));

    return [...results, ...noteResults].slice(0, limit);
  } catch {
    // FTS5 syntax error (e.g., bare special chars) — fall back to LIKE
    return _likeFallback(db, query, { domain, project_id, type, trust_level, status, limit });
  }
}

function _noteFallback(db, query, { domain, project_id, type, trust_level, status, limit }, excludeIds) {
  const like = `%${query}%`;
  let sql = 'SELECT * FROM memories WHERE note LIKE ? AND status = ?';
  const params = [like, status];
  if (domain)      { sql += ' AND domain = ?';       params.push(domain); }
  if (project_id)  { sql += ' AND project_id = ?';   params.push(project_id); }
  if (type)        { sql += ' AND memory_type = ?';  params.push(type); }
  if (trust_level) { sql += ' AND trust_level = ?';  params.push(trust_level); }
  sql += ' ORDER BY importance DESC LIMIT ?';
  params.push(limit);
  return db.prepare(sql).all(...params)
    .filter(m => !excludeIds.has(m.id))
    .map(m => ({ ...m, tags: JSON.parse(m.tags || '[]') }));
}

function _likeFallback(db, query, { domain, project_id, type, trust_level, status, limit }) {
  const like = `%${query}%`;
  let sql = 'SELECT * FROM memories WHERE (title LIKE ? OR content LIKE ? OR note LIKE ?) AND status = ?';
  const params = [like, like, like, status];
  if (domain)      { sql += ' AND domain = ?';       params.push(domain); }
  if (project_id)  { sql += ' AND project_id = ?';   params.push(project_id); }
  if (type)        { sql += ' AND memory_type = ?';  params.push(type); }
  if (trust_level) { sql += ' AND trust_level = ?';  params.push(trust_level); }
  sql += ' ORDER BY importance DESC LIMIT ?';
  params.push(limit);
  return db.prepare(sql).all(...params).map(m => ({ ...m, tags: JSON.parse(m.tags || '[]') }));
}

module.exports = { search };
