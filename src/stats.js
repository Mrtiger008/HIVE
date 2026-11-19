'use strict';
const { getDb } = require('./db');

function full() {
  const db = getDb();

  const total = db.prepare("SELECT COUNT(*) as n FROM memories WHERE status='active'").get().n;
  const archived = db.prepare("SELECT COUNT(*) as n FROM memories WHERE status='archived'").get().n;
  const entities = db.prepare('SELECT COUNT(*) as n FROM entities').get().n;
  const projects = db.prepare("SELECT COUNT(*) as n FROM projects WHERE status='active'").get().n;

  const byType = db.prepare(
    "SELECT memory_type as label, COUNT(*) as count FROM memories WHERE status='active' GROUP BY memory_type ORDER BY count DESC"
  ).all();

  const byTrust = db.prepare(
    "SELECT trust_level as label, COUNT(*) as count FROM memories WHERE status='active' GROUP BY trust_level ORDER BY count DESC"
  ).all();

  const byDomain = db.prepare(
    "SELECT COALESCE(domain,'(none)') as label, COUNT(*) as count FROM memories WHERE status='active' GROUP BY domain ORDER BY count DESC LIMIT 10"
  ).all();

  const avgConf = db.prepare(
    "SELECT ROUND(AVG(confidence),3) as v FROM memories WHERE status='active'"
  ).get().v || 0;

  const avgImportance = db.prepare(
    "SELECT ROUND(AVG(importance),1) as v FROM memories WHERE status='active'"
  ).get().v || 0;

  // Growth: memories created per day for last 30 days
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const rawGrowth = db.prepare(
    "SELECT date(created_at/1000,'unixepoch') as day, COUNT(*) as count FROM memories WHERE created_at >= ? GROUP BY day ORDER BY day"
  ).all(cutoff);

  // Fill gaps with zeros for a dense 30-day array
  const growth = [];
  const today = new Date(); today.setHours(0,0,0,0);
  const growthMap = Object.fromEntries(rawGrowth.map(r => [r.day, r.count]));
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0,10);
    growth.push({ day: key, count: growthMap[key] || 0 });
  }

  return { total, archived, entities, projects, byType, byTrust, byDomain, avgConf, avgImportance, growth };
}

module.exports = { full };
