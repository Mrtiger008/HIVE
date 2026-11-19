'use strict';
const { getDb } = require('./db');

// Returns [{tag, count}] sorted by count desc
function topTags(limit = 50) {
  const rows = getDb().prepare(
    "SELECT tags FROM memories WHERE status='active' AND tags != '[]'"
  ).all();
  const freq = {};
  for (const { tags } of rows) {
    let arr; try { arr = JSON.parse(tags); } catch { continue; }
    for (const t of arr) { const k = String(t).trim().toLowerCase(); if (k) freq[k] = (freq[k]||0) + 1; }
  }
  return Object.entries(freq)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

// Returns memories that share a given tag, as co-occurrence counts with their other tags
function coOccurrence(tag, limit = 10) {
  const rows = getDb().prepare(
    "SELECT tags FROM memories WHERE status='active' AND tags != '[]'"
  ).all();
  const target = tag.toLowerCase();
  const freq = {};
  for (const { tags } of rows) {
    let arr; try { arr = JSON.parse(tags); } catch { continue; }
    const normalized = arr.map(t => String(t).trim().toLowerCase()).filter(Boolean);
    if (!normalized.includes(target)) continue;
    for (const t of normalized) {
      if (t !== target) freq[t] = (freq[t]||0) + 1;
    }
  }
  return Object.entries(freq)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

module.exports = { topTags, coOccurrence };
