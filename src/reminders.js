'use strict';
const { getDb } = require('./db');

const DAY = 24 * 60 * 60 * 1000;

function urgency(idleDays, confidence, importance) {
  if (confidence < 0.3 || idleDays > 60) return 'critical';
  if (confidence < 0.5 || idleDays > 30) return 'high';
  if (confidence < 0.7 || idleDays > 14) return 'medium';
  return 'low';
}

function get({ limit = 20, urgencyFilter = null, projectId = null } = {}) {
  const db = getDb();
  const now = Date.now();

  let where = "WHERE status = 'active'";
  const params = [];
  if (projectId) { where += ' AND project_id = ?'; params.push(projectId); }

  const rows = db.prepare(
    `SELECT id, title, memory_type, domain, project_id, importance, confidence, trust_level,
            created_at, updated_at, last_accessed_at, tags
     FROM memories ${where}`
  ).all(...params);

  const reminders = rows.map(m => {
    const lastSeen = m.last_accessed_at || m.updated_at || m.created_at;
    const idleDays = Math.floor((now - lastSeen) / DAY);
    const u = urgency(idleDays, m.confidence ?? 0.5, m.importance ?? 5);
    return { ...m, idle_days: idleDays, urgency: u };
  })
  .filter(m => m.idle_days >= 7)                     // only memories idle ≥ 1 week
  .filter(m => !urgencyFilter || m.urgency === urgencyFilter)
  .sort((a, b) => {
    const ord = { critical: 0, high: 1, medium: 2, low: 3 };
    if (ord[a.urgency] !== ord[b.urgency]) return ord[a.urgency] - ord[b.urgency];
    if (b.importance !== a.importance)     return b.importance - a.importance;
    return b.idle_days - a.idle_days;
  })
  .slice(0, limit);

  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const r of reminders) counts[r.urgency]++;

  return { reminders, total: reminders.length, counts };
}

function markReviewed(id) {
  const db = getDb();
  const now = Date.now();
  const info = db.prepare(
    "UPDATE memories SET last_accessed_at = ?, updated_at = ? WHERE id = ? AND status = 'active'"
  ).run(now, now, id);
  if (!info.changes) throw new Error(`Memory not found: ${id}`);
  return { id, reviewed_at: now };
}

module.exports = { get, markReviewed, urgency };
