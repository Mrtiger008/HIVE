'use strict';
const { getDb } = require('./db');

// Health score = weighted composite of confidence, recency, and importance.
// Range: 0–100.  Sorted ascending = worst first (triage view).
//
// Weights:  confidence 40%  |  recency 30%  |  importance 30%
// Recency:  exp(-idle_days / HALF_LIFE)  — decays to ~0.5 at HALF_LIFE days idle
const W_CONF = 0.4;
const W_REC  = 0.3;
const W_IMP  = 0.3;
const HALF_LIFE = 30; // days at which recency score halves

function recencyScore(lastAccessedAt, now = Date.now()) {
  if (!lastAccessedAt) return 0.5; // unknown — treat as 30 days idle
  const days = (now - lastAccessedAt) / 86400000;
  return Math.exp(-days / HALF_LIFE);
}

function score(m, now = Date.now()) {
  const conf = Math.min(1, Math.max(0, m.confidence ?? 0.5));
  const rec  = recencyScore(m.last_accessed_at || m.updated_at, now);
  const imp  = Math.min(1, Math.max(0, (m.importance ?? 5) / 10));
  return Math.round((W_CONF * conf + W_REC * rec + W_IMP * imp) * 100);
}

function grade(s) {
  if (s >= 70) return 'good';
  if (s >= 40) return 'fair';
  return 'poor';
}

function list({ limit = 50, projectId, domain, gradeFilter, sortOrder = 'asc' } = {}) {
  const db = getDb();
  let sql = `SELECT * FROM memories WHERE status='active'`;
  const params = [];
  if (projectId) { sql += ` AND project_id = ?`; params.push(projectId); }
  if (domain)    { sql += ` AND domain = ?`;     params.push(domain); }
  const rows = db.prepare(sql).all(...params).map(m => {
    m.tags = JSON.parse(m.tags || '[]');
    return m;
  });

  const now = Date.now();
  const scored = rows.map(m => ({ ...m, health_score: score(m, now), health_grade: grade(score(m, now)) }));

  if (gradeFilter) {
    const filtered = scored.filter(m => m.health_grade === gradeFilter);
    filtered.sort((a, b) => sortOrder === 'asc' ? a.health_score - b.health_score : b.health_score - a.health_score);
    return { memories: filtered.slice(0, limit), total: filtered.length, summary: _summary(scored) };
  }

  scored.sort((a, b) => sortOrder === 'asc' ? a.health_score - b.health_score : b.health_score - a.health_score);
  return { memories: scored.slice(0, limit), total: scored.length, summary: _summary(scored) };
}

function _summary(scored) {
  const counts = { good: 0, fair: 0, poor: 0 };
  let total_score = 0;
  for (const m of scored) { counts[m.health_grade]++; total_score += m.health_score; }
  return {
    good: counts.good,
    fair: counts.fair,
    poor: counts.poor,
    avg_score: scored.length ? Math.round(total_score / scored.length) : 0,
  };
}

module.exports = { score, recencyScore, grade, list };
