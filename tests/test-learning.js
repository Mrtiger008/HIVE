'use strict';
// HIVE Phase 5 — Learning System tests.
// Run: node tests/test-learning.js

const assert = require('assert');
const path   = require('path');
const fs     = require('fs');

const TEST_DB = path.join(__dirname, '..', 'database', 'hive-learning-test.db');
process.env.HIVE_DB = TEST_DB;

fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);

const memory  = require('../src/memory');
const { decayScore, sweep, stalest } = require('../src/decay');
const { reinforce, touch } = require('../src/reinforce');
const { topKeywords } = require('../src/patterns');
const { getDb, closeDb } = require('../src/db');

let pass = 0, fail = 0;

function test(name, fn) {
  try { fn(); console.log(`  ✅  ${name}`); pass++; }
  catch (e) { console.error(`  ❌  ${name}\n      ${e.message}`); fail++; }
}

function addMem(opts = {}) {
  return memory.add({
    title: opts.title || 'Test memory',
    content: opts.content || 'Some content about SQLite and databases.',
    memory_type: opts.memory_type || 'semantic',
    trust_level: opts.trust_level || 'OBSERVED',
    importance: opts.importance ?? 5,
  });
}

// Force last_accessed_at / created_at to a past timestamp
function setLastAccess(id, msAgo) {
  getDb().prepare('UPDATE memories SET last_accessed_at = ? WHERE id = ?')
    .run(Date.now() - msAgo, id);
}
function setCreatedAt(id, msAgo) {
  getDb().prepare('UPDATE memories SET created_at = ?, updated_at = ?, last_accessed_at = NULL WHERE id = ?')
    .run(Date.now() - msAgo, Date.now() - msAgo, id);
}

console.log('\nHIVE — Phase 5 learning system tests\n');

const DAY = 86400000;

// ── L-1: decayScore for fresh memory ─────────────────────────────────────────
test('L-1. decayScore — fresh memory scores ≈ importance', () => {
  const m = addMem({ importance: 6 });
  setLastAccess(m.id, 0); // accessed just now
  const full = { ...m, last_accessed_at: Date.now(), importance: 6 };
  const score = decayScore(full);
  assert(score > 5.9 && score <= 6, `expected ~6, got ${score}`);
});

// ── L-2: decayScore for old memory ───────────────────────────────────────────
test('L-2. decayScore — 60-day-old access scores ≈ importance/3', () => {
  const m = addMem({ importance: 6 });
  const last = Date.now() - 60 * DAY;
  const fake = { ...m, last_accessed_at: last, importance: 6 };
  const score = decayScore(fake);
  // 6 / (1 + 60/30) = 6/3 = 2
  assert(score > 1.9 && score < 2.1, `expected ~2, got ${score}`);
});

// ── L-3: higher importance scores higher at same age ─────────────────────────
test('L-3. decayScore — importance 10 scores 10x higher than importance 1', () => {
  const last = Date.now() - 30 * DAY;
  const hi = decayScore({ importance: 10, last_accessed_at: last });
  const lo = decayScore({ importance: 1,  last_accessed_at: last });
  assert.strictEqual(Math.round(hi / lo), 10, `ratio should be 10, got ${hi/lo}`);
});

// ── L-4: sweep marks 90-day-old memories OUTDATED ────────────────────────────
test('L-4. sweep — marks memories idle 90+ days as OUTDATED', () => {
  const m = addMem({ trust_level: 'OBSERVED' });
  setCreatedAt(m.id, 91 * DAY);
  const changed = sweep();
  assert(changed >= 1, `expected >= 1 change, got ${changed}`);
  const after = getDb().prepare('SELECT trust_level FROM memories WHERE id = ?').get(m.id);
  assert.strictEqual(after.trust_level, 'OUTDATED', `expected OUTDATED, got ${after.trust_level}`);
});

// ── L-5: sweep skips USER_CONFIRMED ──────────────────────────────────────────
test('L-5. sweep — skips USER_CONFIRMED memories', () => {
  const m = addMem({ trust_level: 'USER_CONFIRMED', importance: 9 });
  setCreatedAt(m.id, 95 * DAY);
  sweep();
  const after = getDb().prepare('SELECT trust_level FROM memories WHERE id = ?').get(m.id);
  assert.strictEqual(after.trust_level, 'USER_CONFIRMED', 'USER_CONFIRMED must not be swept');
});

// ── L-6: reinforce bumps importance ──────────────────────────────────────────
test('L-6. reinforce — bumps importance by 1', () => {
  const m = addMem({ importance: 4 });
  const result = reinforce(m.id);
  assert.strictEqual(result.importance, 5, `expected 5, got ${result.importance}`);
});

// ── L-7: reinforce caps at 10 ────────────────────────────────────────────────
test('L-7. reinforce — caps importance at 10', () => {
  const m = addMem({ importance: 10 });
  const result = reinforce(m.id);
  assert.strictEqual(result.importance, 10, 'importance must not exceed 10');
});

// ── L-8: reinforce updates last_accessed_at ───────────────────────────────────
test('L-8. reinforce — updates last_accessed_at to now', () => {
  const m = addMem({ importance: 3 });
  setLastAccess(m.id, 50 * DAY); // set to 50 days ago
  const before = getDb().prepare('SELECT last_accessed_at FROM memories WHERE id = ?').get(m.id).last_accessed_at;
  reinforce(m.id);
  const after = getDb().prepare('SELECT last_accessed_at FROM memories WHERE id = ?').get(m.id).last_accessed_at;
  assert(after > before, 'last_accessed_at should be updated to a more recent time');
  assert(Date.now() - after < 5000, 'last_accessed_at should be within 5s of now');
});

// ── L-9: topKeywords returns frequent non-stop words ─────────────────────────
test('L-9. topKeywords — returns most frequent non-stop words', () => {
  // Add memories containing specific keywords repeatedly
  addMem({ title: 'SQLite WAL mode', content: 'SQLite WAL mode enables concurrent reads in SQLite.' });
  addMem({ title: 'SQLite FTS5 config', content: 'SQLite FTS5 uses porter tokenizer for SQLite search.' });
  addMem({ title: 'SQLite schema design', content: 'SQLite schema uses migrations for SQLite versioning.' });

  const keywords = topKeywords({ days: 365 }); // wide window to catch everything
  const words = keywords.map(k => k.word);
  assert(words.includes('sqlite'), `expected 'sqlite' in top keywords, got: ${words.slice(0,5).join(', ')}`);
  // sqlite should be top since it appears in titles and content of 3 entries
  assert.strictEqual(keywords[0].word, 'sqlite', `sqlite should be #1, got ${keywords[0].word}`);
});

// ── L-10: stalest returns most stale memories first ───────────────────────────
test('L-10. stalest — most stale memory ranks first', () => {
  const fresh = addMem({ title: 'Fresh memory', importance: 5 });
  const old   = addMem({ title: 'Old memory',   importance: 5 });

  setLastAccess(fresh.id, 1 * DAY);   // accessed yesterday
  setLastAccess(old.id,   60 * DAY);  // accessed 60 days ago

  const results = stalest({ limit: 20 });
  const ids = results.map(r => r.id);
  const oldIdx   = ids.indexOf(old.id);
  const freshIdx = ids.indexOf(fresh.id);
  assert(oldIdx !== -1 && freshIdx !== -1, 'both memories must appear in stalest()');
  assert(oldIdx < freshIdx, `old memory (idx ${oldIdx}) should rank before fresh memory (idx ${freshIdx})`);
});

// ── Cleanup ───────────────────────────────────────────────────────────────────
closeDb();
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);

console.log(`\n${pass + fail} tests: ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
