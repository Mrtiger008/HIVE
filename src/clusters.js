'use strict';
const { getDb } = require('./db');

function get({ minShared = 2, limit = 20 } = {}) {
  const db = getDb();

  const rows = db.prepare(
    "SELECT id, title, memory_type, domain, importance, confidence, tags FROM memories WHERE status = 'active'"
  ).all().map(r => ({ ...r, tags: r.tags ? JSON.parse(r.tags) : [] }));

  if (!rows.length) return { clusters: [], unclustered: [] };

  // Build inverted index: tag → memory ids
  const tagIndex = new Map();
  for (const m of rows) {
    for (const t of m.tags) {
      if (!tagIndex.has(t)) tagIndex.set(t, []);
      tagIndex.get(t).push(m.id);
    }
  }

  // Union-Find for clustering by shared tags
  const parent = new Map(rows.map(m => [m.id, m.id]));
  function find(x) {
    if (parent.get(x) !== x) parent.set(x, find(parent.get(x)));
    return parent.get(x);
  }
  function union(a, b) { parent.set(find(a), find(b)); }

  // For each tag that appears on ≥2 memories, union those memories
  for (const [, ids] of tagIndex) {
    if (ids.length < 2) continue;
    for (let i = 1; i < ids.length; i++) union(ids[0], ids[i]);
  }

  // Group by root
  const groups = new Map();
  for (const m of rows) {
    const root = find(m.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(m);
  }

  const clusters = [];
  const unclustered = [];

  for (const [, members] of groups) {
    if (members.length === 1) {
      unclustered.push(members[0]);
      continue;
    }

    // Count tag frequencies within cluster
    const tagCount = new Map();
    for (const m of members) {
      for (const t of m.tags) tagCount.set(t, (tagCount.get(t) || 0) + 1);
    }
    const topTags = [...tagCount.entries()]
      .filter(([, c]) => c >= minShared)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([t]) => t);

    if (!topTags.length) {
      unclustered.push(...members);
      continue;
    }

    const label = topTags.slice(0, 2).join(' + ');
    clusters.push({
      label,
      size: members.length,
      top_tags: topTags,
      members: members.sort((a, b) => b.importance - a.importance),
    });
  }

  clusters.sort((a, b) => b.size - a.size);
  return { clusters: clusters.slice(0, limit), unclustered };
}

module.exports = { get };
