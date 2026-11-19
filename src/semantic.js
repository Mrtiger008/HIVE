'use strict';
// Semantic (vector) search over HIVE memories.
// Uses cosine similarity between query embedding and stored memory embeddings.
// Hybrid mode: blends cosine similarity with FTS5 BM25 score.

const { getDb } = require('./db');
const { embedCached, embedMemory } = require('./embeddings');

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na  += a[i] * a[i];
    nb  += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

// Search memories by semantic similarity.
// embedFn: optional override for testing (defaults to embedCached).
async function search(query, { limit = 10, projectId, hybrid = false, embedFn } = {}) {
  const fn = embedFn || embedCached;
  const queryVec = await fn(`${query}`);

  let sql = `SELECT id, title, content, memory_type, trust_level, importance, embedding, tags
             FROM memories WHERE status = 'active' AND embedding IS NOT NULL`;
  const params = [];
  if (projectId) { sql += ' AND project_id = ?'; params.push(projectId); }

  const rows = getDb().prepare(sql).all(...params);
  if (!rows.length) return [];

  const scored = rows
    .map(r => {
      const vec  = JSON.parse(r.embedding);
      const sim  = cosine(queryVec, vec);
      return { ...r, tags: JSON.parse(r.tags || '[]'), _sim: sim };
    })
    .sort((a, b) => b._sim - a._sim)
    .slice(0, limit);

  if (!hybrid) return scored;

  // Hybrid: re-rank by 0.6 * cosine + 0.4 * normalised importance
  const maxImp = Math.max(...scored.map(r => r.importance), 1);
  return scored
    .map(r => ({ ...r, _hybrid: 0.6 * r._sim + 0.4 * (r.importance / maxImp) }))
    .sort((a, b) => b._hybrid - a._hybrid);
}

// Backfill embeddings for all active memories that don't have one yet.
// embedFn: optional override for testing.
async function backfill({ embedFn, limit = 500 } = {}) {
  const fn = typeof embedFn === 'function'
    ? (m) => { const text = `${m.title} ${m.content}`; return embedFn(text); }
    : (m) => embedMemory(m, { embedFn: embedCached });

  const rows = getDb().prepare(
    `SELECT id, title, content FROM memories WHERE status = 'active' AND embedding IS NULL LIMIT ?`
  ).all(limit);

  let count = 0;
  for (const m of rows) {
    const vec = await fn(m);
    getDb().prepare('UPDATE memories SET embedding = ? WHERE id = ?').run(JSON.stringify(vec), m.id);
    count++;
  }
  return count;
}

module.exports = { cosine, search, backfill };
