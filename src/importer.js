'use strict';
const fs   = require('fs');
const path = require('path');
const memory   = require('./memory');
const { getDb } = require('./db');

// Parse a markdown file into a memory proposal.
// Supports optional YAML frontmatter (--- ... ---) for title/type/trust/importance/tags.
// Falls back to first H1 heading, then filename.
function parseMd(content, filePath) {
  let title = path.basename(filePath, path.extname(filePath)).replace(/[-_]/g, ' ');
  let body   = content;
  const meta = {};

  if (content.startsWith('---\n')) {
    const end = content.indexOf('\n---\n', 4);
    if (end !== -1) {
      const fm = content.slice(4, end);
      body = content.slice(end + 5).trimStart();
      for (const line of fm.split('\n')) {
        const m = line.match(/^([\w_]+):\s*(.+)$/);
        if (m) meta[m[1].toLowerCase()] = m[2].trim().replace(/^["']|["']$/g, '');
      }
    }
  }

  const h1 = body.match(/^# (.+)$/m);
  if (h1) { title = h1[1].trim(); body = body.replace(/^# .+\n?/, '').trimStart(); }
  if (meta.title) title = meta.title;

  return {
    title:       title.replace(/[*_`#]/g, '').slice(0, 200).trim() || 'Untitled',
    content:     body.trim() || title,
    memory_type: meta.type || meta.memory_type || 'semantic',
    trust_level: meta.trust || meta.trust_level || 'OBSERVED',
    importance:  meta.importance ? Math.min(10, Math.max(1, +meta.importance)) : 5,
    tags:        meta.tags ? meta.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
    source:      `file:${filePath}`,
    source_type: 'markdown',
  };
}

function sourceRef(filePath) {
  return `md:${path.resolve(filePath).replace(/\\/g, '/')}`;
}

function alreadyImported(ref) {
  return !!getDb().prepare('SELECT 1 FROM memories WHERE source_ref=? LIMIT 1').get(ref);
}

// Import a single markdown file.
// dry-run (auto=false): returns { proposal } without writing
// auto=true: writes memory, returns { stored }
// already imported: returns { skipped: true, reason }
function importFile(filePath, { auto = false, overrides = {} } = {}) {
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  const content = fs.readFileSync(filePath, 'utf8');
  if (!content.trim()) return { skipped: true, reason: 'empty file' };
  const ref = sourceRef(filePath);
  if (alreadyImported(ref)) return { skipped: true, reason: 'already imported', source_ref: ref };
  const proposal = { ...parseMd(content, filePath), ...overrides, source_ref: ref };
  if (!auto) return { proposal };
  const m = memory.add(proposal);
  return { stored: m };
}

// Import all .md files in a directory (non-recursive).
function importDir(dirPath, { auto = false, limit = 200, overrides = {} } = {}) {
  if (!fs.existsSync(dirPath)) throw new Error(`Directory not found: ${dirPath}`);
  const files = fs.readdirSync(dirPath)
    .filter(f => f.endsWith('.md') || f.endsWith('.markdown'))
    .slice(0, limit)
    .map(f => path.join(dirPath, f));
  const proposals = [], stored = [], skipped = [];
  for (const f of files) {
    const r = importFile(f, { auto, overrides });
    if (r.skipped)   skipped.push({ file: f, reason: r.reason });
    else if (r.stored)   stored.push(r.stored);
    else if (r.proposal) proposals.push({ ...r.proposal, _file: f });
  }
  return { proposals, stored, skipped };
}

module.exports = { parseMd, importFile, importDir };
