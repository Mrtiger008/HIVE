'use strict';
// HIVE Phase 4 — Ingest tests.
// Run: node tests/test-ingest.js

const assert = require('assert');
const path   = require('path');
const fs     = require('fs');
const os     = require('os');

const TEST_DB   = path.join(__dirname, '..', 'database', 'hive-ingest-test.db');
const FIXTURE_SESSION = path.join(__dirname, '..', 'database', 'fixture-session.jsonl');
process.env.HIVE_DB = TEST_DB;

fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
if (fs.existsSync(TEST_DB))          fs.unlinkSync(TEST_DB);
if (fs.existsSync(FIXTURE_SESSION))  fs.unlinkSync(FIXTURE_SESSION);

const { parseSession, extractProposals, fromSession } = require('../src/ingest');
const memory = require('../src/memory');

let pass = 0, fail = 0;

function test(name, fn) {
  try { fn(); console.log(`  ✅  ${name}`); pass++; }
  catch (e) { console.error(`  ❌  ${name}\n      ${e.message}`); fail++; }
}

console.log('\nHIVE — Phase 4 ingest tests\n');

// ── Fixture helpers ───────────────────────────────────────────────────────────

function writeFixture(lines) {
  fs.writeFileSync(FIXTURE_SESSION, lines.map(o => JSON.stringify(o)).join('\n') + '\n', 'utf8');
}

function userMsg(text, uuid = 'u1', ts = '2026-01-01T00:00:00.000Z') {
  return { type: 'user', uuid, timestamp: ts,
    message: { content: typeof text === 'string' ? text : text } };
}

function assistantMsg(blocks, uuid = 'a1', ts = '2026-01-01T00:01:00.000Z') {
  return { type: 'assistant', uuid, timestamp: ts,
    message: { content: blocks.map(b => typeof b === 'string' ? { type: 'text', text: b } : b) } };
}

// ── I-1: parseSession extracts user and assistant turns ──────────────────────
test('I-1. parseSession — extracts clean user and assistant turns', () => {
  writeFixture([
    userMsg('What is the WAL mode in SQLite?'),
    assistantMsg(['WAL (Write-Ahead Logging) mode is an alternative journaling mode in SQLite that allows concurrent readers.']),
  ]);
  const turns = parseSession(FIXTURE_SESSION);
  assert(turns.length >= 2, 'must extract at least 2 turns');
  assert(turns.some(t => t.role === 'user'),      'must have user turn');
  assert(turns.some(t => t.role === 'assistant'), 'must have assistant turn');
});

// ── I-2: system-reminder injections are stripped from user turns ──────────────
test('I-2. parseSession — strips system-reminder from user messages', () => {
  writeFixture([
    userMsg('<system-reminder>Secret config</system-reminder>continue with phase 2'),
    assistantMsg(['Starting phase 2 of the architecture work.']),
  ]);
  const turns = parseSession(FIXTURE_SESSION);
  const userTurns = turns.filter(t => t.role === 'user');
  assert(userTurns.every(t => !t.text.includes('<system-reminder>')), 'system-reminder must be stripped');
  assert(userTurns.some(t => t.text.includes('continue with phase 2')), 'real user text must remain');
});

// ── I-3: thinking blocks are excluded from assistant turns ────────────────────
test('I-3. parseSession — excludes thinking blocks, keeps text blocks', () => {
  writeFixture([
    userMsg('explain FTS5'),
    assistantMsg([
      { type: 'thinking', thinking: 'The user wants an explanation of FTS5.' },
      { type: 'text', text: 'FTS5 is the fifth version of SQLite full-text search.' },
    ]),
  ]);
  const turns = parseSession(FIXTURE_SESSION);
  const asstTurns = turns.filter(t => t.role === 'assistant');
  assert(asstTurns.length > 0, 'must have assistant turn');
  assert(!asstTurns[0].text.includes('The user wants'), 'thinking block must be excluded');
  assert(asstTurns[0].text.includes('FTS5 is'), 'text block must be kept');
});

// ── I-4: filler user messages are not proposed ───────────────────────────────
test('I-4. extractProposals — filler messages filtered out', () => {
  const turns = [
    { role: 'user', text: 'continue', timestamp: '' },
    { role: 'user', text: 'go ahead', timestamp: '' },
    { role: 'user', text: 'ok', timestamp: '' },
    { role: 'user', text: 'tell me about SQLite WAL mode and concurrent access patterns', timestamp: '' },
  ];
  const proposals = extractProposals(turns);
  assert(proposals.some(p => p.content.includes('SQLite WAL')), 'real message must be proposed');
  assert(!proposals.some(p => p.content === 'continue'), 'filler must be excluded');
});

// ── I-5: signal patterns trigger assistant proposals ─────────────────────────
test('I-5. extractProposals — signal patterns in assistant text create proposals', () => {
  const turns = [
    {
      role: 'assistant',
      timestamp: '',
      text: `Root cause: the domain field was included in the haystack causing false substring matches.

The fixed the ambiguity threshold from 70% to 50% to handle adjacent-score projects correctly.`,
    },
  ];
  const proposals = extractProposals(turns);
  assert(proposals.length > 0, 'signal text must generate at least one proposal');
  assert(proposals.some(p => /root cause|fixed|ambiguity/i.test(p.content)), 'proposal must reference the signal content');
});

// ── I-6: noise-only assistant turns produce no proposals ─────────────────────
test('I-6. extractProposals — noise-only assistant text produces no proposals', () => {
  const turns = [
    { role: 'assistant', timestamp: '', text: 'Let me read the file.\n\nI\'m going to check the database.\n\nRunning the tests now.' },
  ];
  const proposals = extractProposals(turns);
  assert(proposals.length === 0, 'pure action narration must produce no proposals');
});

// ── I-7: fromSession dry-run returns proposals without storing ────────────────
test('I-7. fromSession — dry-run returns proposals without storing (auto=false)', () => {
  writeFixture([
    userMsg('The SQLite WAL mode decision: decided to use WAL for concurrent reads in HIVE.'),
    assistantMsg(['Root cause found: the domain field caused false positives in project matching.', 'Fixed by removing domain from the haystack.']),
  ]);
  const before = memory.list({ limit: 100 }).length;
  const { proposals, stored } = fromSession(FIXTURE_SESSION, { auto: false });
  const after = memory.list({ limit: 100 }).length;

  assert(proposals.length > 0,    'proposals must be returned');
  assert.strictEqual(stored.length, 0, 'nothing must be stored in dry-run');
  assert.strictEqual(before, after,    'DB must not change in dry-run');
});

// ── I-8: fromSession auto=true stores memories and deduplicates ───────────────
test('I-8. fromSession — auto=true stores memories and deduplicates on re-run', () => {
  writeFixture([
    userMsg('Decision: use SQLite FTS5 with porter tokenizer for HIVE full-text search.'),
  ]);
  const { stored: first } = fromSession(FIXTURE_SESSION, { auto: true });
  assert(first.length > 0, 'first import must store at least one memory');

  // Re-import — should dedup to 0 new
  const { stored: second } = fromSession(FIXTURE_SESSION, { auto: true });
  assert.strictEqual(second.length, 0, 'second import must store nothing (deduped)');
});

// ── I-9: stored memories have correct source metadata ────────────────────────
test('I-9. fromSession — stored memories have source_ref and source_type set', () => {
  writeFixture([
    userMsg('Important architecture note: the memory module runs secret scanner on every write.'),
  ]);
  const { stored } = fromSession(FIXTURE_SESSION, { auto: true });
  for (const m of stored) {
    const full = memory.get(m.id);
    assert(full.source?.startsWith('session:'), `source must start with 'session:', got ${full.source}`);
    assert(full.source_ref?.startsWith('session:'), 'source_ref must reference session');
  }
});

// ── I-10: short/empty assistant text is not proposed ─────────────────────────
test('I-10. parseSession — very short assistant text is ignored', () => {
  writeFixture([
    userMsg('ping'),
    assistantMsg(['ok']),
  ]);
  const turns = parseSession(FIXTURE_SESSION);
  const asst = turns.filter(t => t.role === 'assistant');
  assert.strictEqual(asst.length, 0, 'assistant text under 10 chars must not produce a turn');
});

// ── Cleanup ───────────────────────────────────────────────────────────────────
const { closeDb } = require('../src/db');
closeDb();
if (fs.existsSync(TEST_DB))          fs.unlinkSync(TEST_DB);
if (fs.existsSync(FIXTURE_SESSION))  fs.unlinkSync(FIXTURE_SESSION);

console.log(`\n${pass + fail} tests: ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
