'use strict';
const path = require('path');
const fs = require('fs');
const { getDb, DB_PATH, BACKUP_DIR } = require('./db');

const MEMORY_DIR = path.join(__dirname, '..', 'memory');

// Write a memory to its Markdown mirror.
// Only syncs if importance >= 7, unless force=true.
function syncToMarkdown(memory, force = false) {
  if (!force && memory.importance < 7) return null;

  let subdir;
  if (memory.memory_type === 'project' && memory.project_id) {
    subdir = path.join('projects', memory.project_id.substring(0, 8));
  } else {
    subdir = memory.memory_type;
  }
  const dir = path.join(MEMORY_DIR, subdir);
  fs.mkdirSync(dir, { recursive: true });

  const slug = memory.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 40);
  const filename = `${memory.id.substring(0, 8)}-${slug}.md`;
  const filepath = path.join(dir, filename);

  const tags = Array.isArray(memory.tags) ? memory.tags : JSON.parse(memory.tags || '[]');
  const content = [
    '---',
    `id: ${memory.id}`,
    `title: "${memory.title}"`,
    `memory_type: ${memory.memory_type}`,
    memory.domain ? `domain: ${memory.domain}` : null,
    memory.project_id ? `project_id: ${memory.project_id}` : null,
    `trust_level: ${memory.trust_level}`,
    `confidence: ${memory.confidence}`,
    `importance: ${memory.importance}`,
    `status: ${memory.status}`,
    `created_at: ${new Date(memory.created_at).toISOString()}`,
    `updated_at: ${new Date(memory.updated_at).toISOString()}`,
    tags.length ? `tags: [${tags.map(t => `"${t}"`).join(', ')}]` : null,
    memory.source ? `source: "${memory.source}"` : null,
    '---',
    '',
    `# ${memory.title}`,
    '',
    memory.content,
  ].filter(l => l !== null).join('\n');

  fs.writeFileSync(filepath, content, 'utf8');
  return filepath;
}

// Export ALL active memories to Markdown, regardless of importance.
function exportAll() {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM memories WHERE status = 'active'").all();
  let count = 0;
  for (const m of rows) {
    m.tags = JSON.parse(m.tags || '[]');
    if (syncToMarkdown(m, true)) count++;
  }
  return count;
}

// Create a timestamped backup of hive.db.
function backup() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const dest = path.join(BACKUP_DIR, `hive-${ts}.db`);
  const db = getDb();
  // Checkpoint WAL to main file, then copy
  db.pragma('wal_checkpoint(TRUNCATE)');
  fs.copyFileSync(DB_PATH, dest);
  return dest;
}

module.exports = { syncToMarkdown, exportAll, backup };
