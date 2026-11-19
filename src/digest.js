'use strict';
const { getDb } = require('./db');

const DAY = 24 * 60 * 60 * 1000;

function _parse(m) {
  if (!m) return null;
  try { m.tags = JSON.parse(m.tags || '[]'); } catch { m.tags = []; }
  return m;
}

function daily() {
  const db = getDb();
  const now = Date.now();
  const cutNew   = now - DAY;          // added in last 24 h
  const cutStale = now - 7 * DAY;      // not updated in 7+ days

  const new_memories = db.prepare(
    "SELECT id, title, memory_type, trust_level, importance, tags, created_at FROM memories WHERE status='active' AND created_at >= ? ORDER BY created_at DESC"
  ).all(cutNew).map(_parse);

  const stale_memories = db.prepare(
    "SELECT id, title, memory_type, trust_level, importance, updated_at FROM memories WHERE status='active' AND updated_at < ? ORDER BY updated_at ASC LIMIT 20"
  ).all(cutStale).map(_parse);

  const low_conf_memories = db.prepare(
    "SELECT id, title, memory_type, confidence, importance FROM memories WHERE status='active' AND confidence < 0.4 ORDER BY confidence ASC LIMIT 10"
  ).all();

  const { total } = db.prepare("SELECT COUNT(*) as total FROM memories WHERE status='active'").get();

  return {
    period: 'daily',
    generated_at: now,
    total_active: total,
    new_memories,
    stale_memories,
    low_conf_memories,
  };
}

function weekly() {
  const db = getDb();
  const now = Date.now();
  const cutNew   = now - 7 * DAY;
  const cutStale = now - 30 * DAY;

  const new_memories = db.prepare(
    "SELECT id, title, memory_type, trust_level, importance, tags, created_at FROM memories WHERE status='active' AND created_at >= ? ORDER BY created_at DESC"
  ).all(cutNew).map(_parse);

  const stale_memories = db.prepare(
    "SELECT id, title, memory_type, updated_at FROM memories WHERE status='active' AND updated_at < ? ORDER BY updated_at ASC LIMIT 30"
  ).all(cutStale).map(_parse);

  // Top domains by activity in the last 7 days
  const top_domains = db.prepare(
    "SELECT domain, COUNT(*) as count FROM memories WHERE status='active' AND domain IS NOT NULL AND created_at >= ? GROUP BY domain ORDER BY count DESC LIMIT 5"
  ).all(cutNew);

  const { total } = db.prepare("SELECT COUNT(*) as total FROM memories WHERE status='active'").get();

  return {
    period: 'weekly',
    generated_at: now,
    total_active: total,
    new_memories,
    stale_memories,
    top_domains,
  };
}

module.exports = { daily, weekly };
