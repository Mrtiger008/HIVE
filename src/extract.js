'use strict';
// Phase 8 — Entity Extraction / Auto-tagging.
// Scans memory content for mentions of known entities, stores links in memory_entity_links.

const { getDb } = require('./db');

const MIN_NAME_LEN = 3;
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Scan text for mentions of known entities (names + aliases).
// Returns [ { entity, confidence, matchedName } ] sorted by confidence desc.
function detectMentions(text) {
  if (!text) return [];
  const entities = getDb().prepare(
    `SELECT id, name, aliases, entity_type FROM entities LIMIT 1000`
  ).all();

  const hits = [];
  for (const e of entities) {
    const names = [e.name, ...JSON.parse(e.aliases || '[]')];
    for (const n of names) {
      if (n.length < MIN_NAME_LEN) continue;
      const re = new RegExp(`\\b${escRe(n)}\\b`, 'i');
      if (!re.test(text)) continue;
      // Longer name → higher confidence (more specific match)
      const confidence = Math.min(0.9, 0.3 + n.length * 0.05);
      hits.push({ entity: e, confidence, matchedName: n });
      break; // one match per entity
    }
  }
  return hits.sort((a, b) => b.confidence - a.confidence);
}

// Extract entity mentions from a memory and persist memory_entity_links.
function extractAndLink(memoryId, { title = '', content = '' } = {}) {
  const hits = detectMentions(`${title} ${content}`);
  if (!hits.length) return [];
  const now = Date.now();
  const insert = getDb().prepare(`
    INSERT OR REPLACE INTO memory_entity_links (memory_id, entity_id, confidence, auto, created_at)
    VALUES (?, ?, ?, 1, ?)
  `);
  for (const { entity, confidence } of hits) insert.run(memoryId, entity.id, confidence, now);
  return hits.map(h => ({ entityId: h.entity.id, name: h.entity.name, type: h.entity.entity_type, confidence: h.confidence }));
}

// Get entities linked to a memory.
function linkedEntities(memoryId) {
  return getDb().prepare(`
    SELECT e.*, mel.confidence, mel.auto
    FROM memory_entity_links mel
    JOIN entities e ON e.id = mel.entity_id
    WHERE mel.memory_id = ?
    ORDER BY mel.confidence DESC
  `).all(memoryId).map(e => ({ ...e, aliases: JSON.parse(e.aliases || '[]') }));
}

// Get active memories linked to an entity.
function linkedMemories(entityId, { limit = 20 } = {}) {
  return getDb().prepare(`
    SELECT m.*, mel.confidence, mel.auto
    FROM memory_entity_links mel
    JOIN memories m ON m.id = mel.memory_id
    WHERE mel.entity_id = ? AND m.status = 'active'
    ORDER BY mel.confidence DESC, m.importance DESC
    LIMIT ?
  `).all(entityId, limit).map(m => ({ ...m, tags: JSON.parse(m.tags || '[]') }));
}

// Backfill: run extraction for memories that have no entity links yet.
function backfill({ limit = 500 } = {}) {
  const rows = getDb().prepare(`
    SELECT m.id, m.title, m.content
    FROM memories m
    WHERE m.status = 'active'
      AND NOT EXISTS (SELECT 1 FROM memory_entity_links mel WHERE mel.memory_id = m.id)
    LIMIT ?
  `).all(limit);
  let count = 0;
  for (const m of rows) {
    const links = extractAndLink(m.id, { title: m.title, content: m.content });
    if (links.length) count++;
  }
  return { processed: rows.length, linked: count };
}

module.exports = { detectMentions, extractAndLink, linkedEntities, linkedMemories, backfill };
