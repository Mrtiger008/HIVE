'use strict';
const { getDb } = require('./db');

const TYPE_COLORS = {
  core:      '#ff7b72',
  domain:    '#d2a8ff',
  project:   '#3fb950',
  episodic:  '#ffa657',
  semantic:  '#58a6ff',
  skill:     '#79c0ff',
};

const EDGE_COLORS = {
  related:      '#58a6ff',
  supports:     '#3fb950',
  contradicts:  '#f85149',
  supersedes:   '#ffa657',
  predecessor:  '#d2a8ff',
  'see-also':   '#8b949e',
};

function build() {
  const db = getDb();

  const rows = db.prepare(
    "SELECT id, title, memory_type, importance, confidence, pinned FROM memories WHERE status = 'active'"
  ).all();

  const activeIds = new Set(rows.map(r => r.id));

  const links = db.prepare(`
    SELECT r.id, r.from_id, r.to_id, r.rel_type
    FROM relationships r
    WHERE r.from_id IN (SELECT id FROM memories WHERE status = 'active')
      AND r.to_id   IN (SELECT id FROM memories WHERE status = 'active')
  `).all().filter(l => activeIds.has(l.from_id) && activeIds.has(l.to_id));

  const nodes = rows.map(m => ({
    id:          m.id,
    label:       m.title,
    type:        m.memory_type,
    importance:  m.importance,
    confidence:  m.confidence,
    pinned:      m.pinned,
    color:       TYPE_COLORS[m.memory_type] || '#8b949e',
    size:        6 + Math.round(m.importance * 1.4),
  }));

  const edges = links.map(l => ({
    id:       l.id,
    from:     l.from_id,
    to:       l.to_id,
    rel_type: l.rel_type,
    color:    EDGE_COLORS[l.rel_type] || '#8b949e',
  }));

  return { nodes, edges };
}

module.exports = { build, TYPE_COLORS, EDGE_COLORS };
