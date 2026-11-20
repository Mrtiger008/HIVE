'use strict';
const { getDb } = require('./db');
const { auditLog } = require('./audit');

// Max confidence each trust level can legitimately carry
const TRUST_CEILING = {
  USER_CONFIRMED:  1.0,
  SOURCE_VERIFIED: 0.9,
  OBSERVED:        0.75,
  INFERRED:        0.6,
  AI_HYPOTHESIS:   0.4,
  CONFLICTED:      0.2,
  OUTDATED:        0.1,
  UNKNOWN:         0.3,
};

// Confidence half-life in days per trust level (Infinity = no decay)
const HALF_LIFE = {
  USER_CONFIRMED:  Infinity,
  SOURCE_VERIFIED: 365,
  OBSERVED:        180,
  INFERRED:        90,
  AI_HYPOTHESIS:   60,
  CONFLICTED:      30,
  OUTDATED:        30,
  UNKNOWN:         90,
};

const CONF_FLOOR = 0.05;
const DELTA_THRESHOLD = 0.02; // ignore sub-2% changes

function _calibrate(m, now = Date.now()) {
  const ceiling = TRUST_CEILING[m.trust_level] ?? 0.5;
  const halfLife = HALF_LIFE[m.trust_level] ?? 90;
  const ageDays = (now - (m.updated_at || m.created_at)) / 86400000;
  const decay = halfLife === Infinity ? 1 : Math.exp(-ageDays / halfLife);
  const raw = Math.min(m.confidence, ceiling) * decay;
  return Math.max(CONF_FLOOR, Math.round(raw * 1000) / 1000);
}

function preview({ limit = 200 } = {}) {
  const now = Date.now();
  const rows = getDb().prepare(
    "SELECT id, title, confidence, trust_level, created_at, updated_at FROM memories WHERE status='active' ORDER BY updated_at DESC LIMIT ?"
  ).all(limit);
  return rows
    .map(m => {
      const newConf = _calibrate(m, now);
      const delta = +(newConf - m.confidence).toFixed(3);
      const ceiling = TRUST_CEILING[m.trust_level] ?? 0.5;
      const halfLife = HALF_LIFE[m.trust_level] ?? 90;
      const ageDays = Math.round((now - (m.updated_at || m.created_at)) / 86400000);
      let reason = '';
      if (m.confidence > ceiling) reason = `exceeds ${m.trust_level} ceiling (${ceiling})`;
      else if (halfLife !== Infinity) reason = `${ageDays}d old, half-life ${halfLife}d`;
      return { id: m.id, title: m.title, old_confidence: m.confidence, new_confidence: newConf, delta, trust_level: m.trust_level, reason };
    })
    .filter(r => Math.abs(r.delta) >= DELTA_THRESHOLD)
    .sort((a, b) => a.delta - b.delta); // most-decreased first
}

function apply({ limit = 200 } = {}) {
  const changes = preview({ limit });
  const now = Date.now();
  const db = getDb();
  const stmt = db.prepare('UPDATE memories SET confidence = ?, updated_at = ? WHERE id = ?');
  const run = db.transaction(() => {
    for (const c of changes) {
      stmt.run(c.new_confidence, now, c.id);
      auditLog('UPDATE', 'memory', c.id, { calibrated: true, old: c.old_confidence, new: c.new_confidence });
    }
  });
  run();
  return { applied: changes.length, changes };
}

module.exports = { preview, apply, _calibrate, TRUST_CEILING, HALF_LIFE };
