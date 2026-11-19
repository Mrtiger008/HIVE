'use strict';
const { getDb } = require('./db');

function get({ days = 30, granularity = 'day', memory_type = null, domain = null } = {}) {
  const db = getDb();
  const since = Date.now() - days * 24 * 60 * 60 * 1000;

  let where = "WHERE status = 'active' AND created_at >= ?";
  const params = [since];
  if (memory_type) { where += ' AND memory_type = ?'; params.push(memory_type); }
  if (domain)      { where += ' AND domain = ?';      params.push(domain); }

  const rows = db.prepare(
    `SELECT id, title, memory_type, domain, importance, confidence, created_at, updated_at
     FROM memories ${where} ORDER BY created_at ASC`
  ).all(...params);

  // Group by period
  const msPerDay  = 24 * 60 * 60 * 1000;
  const msPerWeek = 7  * msPerDay;
  const bucket = granularity === 'week' ? msPerWeek : msPerDay;

  const startOf = ts => {
    const d = new Date(ts);
    if (granularity === 'week') {
      // Floor to Monday
      const day = d.getUTCDay(); // 0=Sun
      const diff = (day === 0 ? -6 : 1 - day);
      d.setUTCDate(d.getUTCDate() + diff);
    }
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).getTime();
  };

  const map = new Map();
  for (const r of rows) {
    const key = startOf(r.created_at);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  }

  // Fill in zero-count periods
  const periodStart = startOf(since);
  const periodEnd   = startOf(Date.now());
  const periods = [];
  for (let t = periodStart; t <= periodEnd; t += bucket) {
    const memories = map.get(t) || [];
    periods.push({
      date:  new Date(t).toISOString().slice(0, granularity === 'week' ? 10 : 10),
      ts:    t,
      count: memories.length,
      memories,
    });
  }

  return { periods, total: rows.length, days, granularity };
}

module.exports = { get };
