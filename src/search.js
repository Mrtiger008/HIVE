'use strict';
const { getDb } = require('./db');

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

  let sql = `
    SELECT m.*, bm25(memories_fts) AS _rank
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
    return db.prepare(sql).all(...params).map(m => ({ ...m, tags: JSON.parse(m.tags || '[]') }));
  } catch {
    // FTS5 syntax error (e.g., bare special chars) — fall back to LIKE
    return _likeFallback(db, query, { domain, project_id, type, trust_level, status, limit });
  }
}

function _likeFallback(db, query, { domain, project_id, type, trust_level, status, limit }) {
  const like = `%${query}%`;
  let sql = 'SELECT * FROM memories WHERE (title LIKE ? OR content LIKE ?) AND status = ?';
  const params = [like, like, status];
  if (domain)      { sql += ' AND domain = ?';       params.push(domain); }
  if (project_id)  { sql += ' AND project_id = ?';   params.push(project_id); }
  if (type)        { sql += ' AND memory_type = ?';  params.push(type); }
  if (trust_level) { sql += ' AND trust_level = ?';  params.push(trust_level); }
  sql += ' ORDER BY importance DESC LIMIT ?';
  params.push(limit);
  return db.prepare(sql).all(...params).map(m => ({ ...m, tags: JSON.parse(m.tags || '[]') }));
}

module.exports = { search };
