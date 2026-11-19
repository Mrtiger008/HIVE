'use strict';
// Phase 4 — Session Capture & Ingestion
// Two ingestion paths:
//   fromSession(jsonlPath) — parse a Claude Code JSONL transcript
//   fromClaudeMem(opts)    — pull from ~/.claude-mem/claude-mem.db

const fs      = require('fs');
const path    = require('path');
const os      = require('os');
const { getDb } = require('./db');
const memory  = require('./memory');

// ── JSONL session parser ──────────────────────────────────────────────────────

// Extract clean turns from a Claude Code session JSONL file.
// Returns [{role:'user'|'assistant', text, timestamp}]
function parseSession(jsonlPath) {
  const raw = fs.readFileSync(jsonlPath, 'utf8');
  const turns = [];

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }

    if (obj.type === 'user' && obj.message?.content) {
      const text = _extractUserText(obj.message.content);
      if (text) turns.push({ role: 'user', text, timestamp: obj.timestamp });
    }

    if (obj.type === 'assistant' && obj.message?.content) {
      const text = _extractAssistantText(obj.message.content);
      if (text) turns.push({ role: 'assistant', text, timestamp: obj.timestamp });
    }
  }

  return turns;
}

function _extractUserText(content) {
  let text = '';
  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    text = content.filter(b => b.type === 'text').map(b => b.text).join('\n');
  }
  // Drop system-reminder injections (they come through as user-role messages)
  text = text.replace(/<system-reminder[\s\S]*?<\/system-reminder>/g, '').trim();
  if (text.length < 5) return null;
  return text;
}

function _extractAssistantText(content) {
  if (!Array.isArray(content)) return null;
  // Skip 'thinking' blocks; join 'text' blocks
  const text = content
    .filter(b => b.type === 'text' && b.text)
    .map(b => b.text)
    .join('\n')
    .trim();
  return text.length >= 10 ? text : null;
}

// ── Proposal extraction from turns ───────────────────────────────────────────

// Patterns that signal a noteworthy fact worth storing
const SIGNAL_PATTERNS = [
  /\b(decided|decision|root cause|fixed|fix:|bug:|note:|key insight|architecture|pattern|important|warning|gotcha|caveat)\b/i,
  /\b(must be|must not|always|never|requires|constraint|limitation|assumption)\b/i,
  /\*\*(decision|fix|note|key|root cause|architecture|warning)\*\*/i,
];

// Noise prefixes — assistant action narration, not facts
const NOISE_PREFIXES = [
  /^(let me |i'll |i'm going to |running |reading |checking |looking at |now |ok,? |sure,? |great,? )/i,
  /^(the user |this |that )/i,
];

function extractProposals(turns, { maxProposals = 15 } = {}) {
  const proposals = [];

  for (const turn of turns) {
    if (turn.role === 'user') {
      // Real user messages are high-signal context (not "continue" or "go ahead")
      if (turn.text.length > 20 && !_isFillerMessage(turn.text)) {
        proposals.push({
          title: _titleFromText(turn.text),
          content: turn.text,
          memory_type: 'episodic',
          trust_level: 'USER_CONFIRMED',
          importance: 6,
          source: 'session:user',
        });
      }
      continue;
    }

    // Assistant: extract sentences/paragraphs that match signal patterns
    const paras = turn.text.split(/\n{2,}/).map(p => p.trim()).filter(p => p.length > 40);
    for (const para of paras) {
      if (!SIGNAL_PATTERNS.some(p => p.test(para))) continue;
      if (NOISE_PREFIXES.some(p => p.test(para))) continue;
      proposals.push({
        title: _titleFromText(para),
        content: para,
        memory_type: 'semantic',
        trust_level: 'OBSERVED',
        importance: 5,
        source: 'session:assistant',
      });
    }
  }

  return proposals.slice(0, maxProposals);
}

function _isFillerMessage(text) {
  return /^(continue|go ahead|yes|ok|okay|sure|thanks?|good|great|done|next|proceed|show me|keep going)\.?$/i.test(text.trim());
}

function _titleFromText(text) {
  // First sentence, truncated to 80 chars
  const first = text.split(/[.!?\n]/)[0].trim().replace(/\*\*/g, '');
  return first.length > 80 ? first.slice(0, 77) + '...' : first;
}

// ── fromSession ───────────────────────────────────────────────────────────────

// Parse a JSONL session and return proposals (or store them if auto=true).
// source_ref = 'session:<sessionId>' for dedup.
function fromSession(jsonlPath, { projectId, auto = false, maxProposals = 15 } = {}) {
  if (!fs.existsSync(jsonlPath)) throw new Error(`Session file not found: ${jsonlPath}`);

  const sessionId = path.basename(jsonlPath, '.jsonl');
  const sourcePrefix = `session:${sessionId}`;

  const turns     = parseSession(jsonlPath);
  const proposals = extractProposals(turns, { maxProposals });

  if (!auto) return { proposals, stored: [] };

  const stored = [];
  for (const p of proposals) {
    // Dedup: skip if a memory with this source_ref already exists
    const exists = getDb().prepare('SELECT id FROM memories WHERE source_ref = ?')
      .get(`${sourcePrefix}:${_hash(p.content)}`);
    if (exists) continue;

    const m = memory.add({
      title: p.title,
      content: p.content,
      memory_type: p.memory_type,
      trust_level: p.trust_level,
      importance: p.importance,
      project_id: projectId || null,
      source: p.source,
      source_ref: `${sourcePrefix}:${_hash(p.content)}`,
      source_type: 'session',
    });
    stored.push(m);
  }

  return { proposals, stored };
}

// ── fromClaudeMem ─────────────────────────────────────────────────────────────

const CLAUDE_MEM_DB = path.join(os.homedir(), '.claude-mem', 'claude-mem.db');

// Map claude-mem observation types to HIVE memory types
const TYPE_MAP = {
  discovery:    'semantic',
  feature:      'project',
  change:       'project',
  bugfix:       'semantic',
  decision:     'semantic',
  security:     'core',
  observation:  'episodic',
};

// Ingest observations from claude-mem into HIVE.
// Dedup via source_ref = 'claude-mem:<id>'.
function fromClaudeMem({ project = '', limit = 50, auto = false, projectId } = {}) {
  if (!fs.existsSync(CLAUDE_MEM_DB))
    throw new Error(`claude-mem database not found at ${CLAUDE_MEM_DB}`);

  const Database = require('better-sqlite3');
  const cmDb = new Database(CLAUDE_MEM_DB, { readonly: true });

  const rows = project
    ? cmDb.prepare('SELECT * FROM observations WHERE project LIKE ? ORDER BY id DESC LIMIT ?')
        .all(`%${project}%`, limit)
    : cmDb.prepare('SELECT * FROM observations ORDER BY id DESC LIMIT ?').all(limit);
  cmDb.close();

  const proposals = rows.map(r => ({
    title:       r.title || `Observation ${r.id}`,
    content:     r.narrative || r.text || '',
    memory_type: TYPE_MAP[r.type] || 'episodic',
    trust_level: 'OBSERVED',
    importance:  5,
    source:      `claude-mem:${r.project}`,
    source_ref:  `claude-mem:${r.id}`,
    _cm_id:      r.id,
  })).filter(p => p.content.length > 10);

  if (!auto) return { proposals, stored: [] };

  const hiveDb = getDb();
  const stored = [];
  for (const p of proposals) {
    const exists = hiveDb.prepare('SELECT id FROM memories WHERE source_ref = ?').get(p.source_ref);
    if (exists) continue;
    const m = memory.add({
      title:       p.title,
      content:     p.content,
      memory_type: p.memory_type,
      trust_level: p.trust_level,
      importance:  p.importance,
      project_id:  projectId || null,
      source:      p.source,
      source_ref:  p.source_ref,
      source_type: 'claude-mem',
    });
    stored.push(m);
  }

  return { proposals, stored };
}

// djb2 hash — short stable fingerprint for content dedup
function _hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
  return (h >>> 0).toString(16);
}

module.exports = { parseSession, extractProposals, fromSession, fromClaudeMem, CLAUDE_MEM_DB };
