'use strict';
const { getDb } = require('./db');

// A gap is a weak spot in the knowledge base.
// Three gap types:
//   'low_confidence' — domain or type where avg confidence < threshold
//   'sparse'         — domain or type with fewer than minCount memories
//   'critical'       — individual memory: high importance but low confidence

function get({ minCount = 3, confThreshold = 0.5, importanceFloor = 7, limit = 20 } = {}) {
  const db = getDb();

  // ── Per-domain stats ──────────────────────────────────────────────────────
  const domainStats = db.prepare(`
    SELECT domain,
           COUNT(*)                       AS count,
           ROUND(AVG(confidence), 3)      AS avg_conf,
           ROUND(AVG(importance), 2)      AS avg_imp
    FROM memories
    WHERE status='active' AND domain IS NOT NULL AND domain != ''
    GROUP BY domain
    ORDER BY avg_conf ASC
  `).all();

  // ── Per-type stats ────────────────────────────────────────────────────────
  const typeStats = db.prepare(`
    SELECT memory_type,
           COUNT(*)                       AS count,
           ROUND(AVG(confidence), 3)      AS avg_conf,
           ROUND(AVG(importance), 2)      AS avg_imp
    FROM memories
    WHERE status='active'
    GROUP BY memory_type
    ORDER BY avg_conf ASC
  `).all();

  // ── High-importance, low-confidence individual memories ───────────────────
  const critical = db.prepare(`
    SELECT id, title, memory_type, domain, confidence, importance
    FROM memories
    WHERE status='active'
      AND importance >= ?
      AND confidence < ?
    ORDER BY importance DESC, confidence ASC
    LIMIT ?
  `).all(importanceFloor, confThreshold, limit);

  const gaps = [];

  // Low-confidence domains
  for (const d of domainStats) {
    if (d.avg_conf < confThreshold) {
      gaps.push({
        type: 'low_confidence',
        scope: 'domain',
        label: d.domain,
        count: d.count,
        avg_confidence: d.avg_conf,
        avg_importance: d.avg_imp,
        severity: d.avg_conf < 0.3 ? 'high' : 'medium',
      });
    }
  }

  // Low-confidence types
  for (const t of typeStats) {
    if (t.avg_conf < confThreshold) {
      gaps.push({
        type: 'low_confidence',
        scope: 'type',
        label: t.memory_type,
        count: t.count,
        avg_confidence: t.avg_conf,
        avg_importance: t.avg_imp,
        severity: t.avg_conf < 0.3 ? 'high' : 'medium',
      });
    }
  }

  // Sparse domains (few memories = coverage risk)
  for (const d of domainStats) {
    if (d.count < minCount) {
      gaps.push({
        type: 'sparse',
        scope: 'domain',
        label: d.domain,
        count: d.count,
        avg_confidence: d.avg_conf,
        avg_importance: d.avg_imp,
        severity: d.count === 1 ? 'high' : 'medium',
      });
    }
  }

  // Critical: high-importance, low-confidence individual memories
  for (const m of critical) {
    gaps.push({
      type: 'critical',
      scope: 'memory',
      label: m.title,
      memory_id: m.id,
      memory_type: m.memory_type,
      domain: m.domain,
      count: 1,
      avg_confidence: m.confidence,
      avg_importance: m.importance,
      severity: m.confidence < 0.3 ? 'high' : 'medium',
    });
  }

  // Sort: high severity first, then by avg_confidence ascending
  gaps.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'high' ? -1 : 1;
    return a.avg_confidence - b.avg_confidence;
  });

  return {
    gaps: gaps.slice(0, limit),
    total: gaps.length,
    summary: {
      low_confidence_domains: domainStats.filter(d => d.avg_conf < confThreshold).length,
      low_confidence_types:   typeStats.filter(t => t.avg_conf < confThreshold).length,
      sparse_domains:         domainStats.filter(d => d.count < minCount).length,
      critical_memories:      critical.length,
    },
  };
}

module.exports = { get };
