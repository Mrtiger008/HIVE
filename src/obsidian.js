'use strict';
const fs   = require('fs');
const path = require('path');
const { getDb } = require('./db');

function slugify(title) {
  return title.toLowerCase().replace(/[^\w\s-]/g, '').replace(/[\s_]+/g, '-').replace(/^-+|-+$/g, '') || 'memory';
}

function _parseLinks(memoryId) {
  const db = getDb();
  return db.prepare(`
    SELECT r.id, r.from_id, r.to_id, r.rel_type,
           mf.title AS from_title, mt.title AS to_title
    FROM relationships r
    LEFT JOIN memories mf ON mf.id = r.from_id
    LEFT JOIN memories mt ON mt.id = r.to_id
    WHERE (r.from_id = ? OR r.to_id = ?)
      AND mf.status = 'active' AND mt.status = 'active'
  `).all(memoryId, memoryId);
}

function generate() {
  const db = getDb();
  const rows = db.prepare(
    "SELECT * FROM memories WHERE status = 'active' ORDER BY importance DESC, updated_at DESC"
  ).all();

  return rows.map(m => {
    let tags = [];
    try { tags = JSON.parse(m.tags || '[]'); } catch {}

    const links = _parseLinks(m.id);
    const linkLines = links.map(l => {
      const isFrom = l.from_id === m.id;
      const other = isFrom ? (l.to_title || l.to_id) : (l.from_title || l.from_id);
      const dir = isFrom ? '→' : '←';
      return `- ${dir} [[${slugify(other)}]] *(${l.rel_type})*`;
    });

    const frontmatter = [
      '---',
      `id: "${m.id}"`,
      `title: "${m.title.replace(/"/g, '\\"')}"`,
      `memory_type: ${m.memory_type}`,
      `trust_level: ${m.trust_level}`,
      `confidence: ${m.confidence}`,
      `importance: ${m.importance}`,
      `status: ${m.status}`,
      tags.length ? `tags: [${tags.map(t => `"${t}"`).join(', ')}]` : 'tags: []',
      m.domain ? `domain: ${m.domain}` : null,
      m.project_id ? `project_id: "${m.project_id}"` : null,
      `created: ${new Date(m.created_at).toISOString().slice(0, 10)}`,
      `updated: ${new Date(m.updated_at).toISOString().slice(0, 10)}`,
      '---',
    ].filter(Boolean).join('\n');

    let content = `${frontmatter}\n\n# ${m.title}\n\n${m.content}`;
    if (linkLines.length) content += `\n\n## Links\n\n${linkLines.join('\n')}`;
    if (tags.length) content += `\n\n## Tags\n\n${tags.map(t => `#${t}`).join('  ')}`;

    return { filename: `${slugify(m.title)}.md`, content, id: m.id, title: m.title };
  });
}

function writeVault(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const files = generate();
  for (const f of files) {
    fs.writeFileSync(path.join(dir, f.filename), f.content, 'utf8');
  }
  return files.length;
}

module.exports = { generate, writeVault, slugify };
