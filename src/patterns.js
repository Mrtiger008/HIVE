'use strict';
const { getDb } = require('./db');

const STOP = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'are', 'was', 'has', 'have',
  'can', 'will', 'may', 'not', 'but', 'from', 'via', 'its', 'how', 'what',
  'why', 'when', 'does', 'did', 'been', 'into', 'about', 'used', 'use',
  'you', 'your', 'all', 'also', 'more', 'than', 'then', 'they', 'them',
  'their', 'which', 'where', 'were', 'each', 'any', 'one', 'two', 'three',
  'it', 'in', 'is', 'of', 'to', 'a', 'an', 'or', 'at', 'on', 'as', 'if',
  'by', 'be', 'so', 'just', 'get', 'set', 'run', 'very',
]);

// Return most frequent keywords from active memories created in the last N days.
function topKeywords({ days = 30, limit = 10, projectId } = {}) {
  const cutoff = Date.now() - days * 86400000;
  let sql = 'SELECT title, content FROM memories WHERE status = ? AND created_at > ?';
  const params = ['active', cutoff];
  if (projectId) { sql += ' AND project_id = ?'; params.push(projectId); }

  const rows = getDb().prepare(sql).all(...params);
  const freq = new Map();

  for (const { title, content } of rows) {
    const words = `${title} ${content}`.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) || [];
    for (const w of words) {
      if (!STOP.has(w)) freq.set(w, (freq.get(w) || 0) + 1);
    }
  }

  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word, count]) => ({ word, count }));
}

module.exports = { topKeywords };
