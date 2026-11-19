'use strict';
// HIVE Phase 1 baseline tests — 10 tests from the spec.
// Uses only Node.js built-in assert. No test framework.
// Run: node tests/test.js

const assert = require('assert');
const path   = require('path');
const fs     = require('fs');

// Redirect to a throwaway test database so we never touch hive.db
const TEST_DB = path.join(__dirname, '..', 'database', 'hive-test.db');
process.env.HIVE_DB = TEST_DB;

// Clean slate before tests
fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);

const memory   = require('../src/memory');
const projects = require('../src/projects');
const { search } = require('../src/search');

let pass = 0, fail = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅  ${name}`);
    pass++;
  } catch (e) {
    console.error(`  ❌  ${name}`);
    console.error(`      ${e.message}`);
    fail++;
  }
}

console.log('\nHIVE — Phase 1 baseline tests\n');

// ── Test 1: Exact memory retrieval ─────────────────────────────────────────
test('1. Exact memory retrieval — returns correct content and source', () => {
  const m = memory.add({
    title: 'FTS5 BM25 ranking',
    content: 'SQLite FTS5 uses BM25 ranking by default. Porter stemmer is applied.',
    memory_type: 'semantic',
    trust_level: 'USER_CONFIRMED',
    importance: 8,
    source: 'docs/ARCHITECTURE.md',
  });
  const got = memory.get(m.id);
  assert.strictEqual(got.title, 'FTS5 BM25 ranking');
  assert.strictEqual(got.trust_level, 'USER_CONFIRMED');
  assert(got.content.includes('BM25'));
  assert.strictEqual(got.source, 'docs/ARCHITECTURE.md');
});

// ── Test 2: Project isolation ───────────────────────────────────────────────
test('2. Project isolation — project A memories excluded from project B query', () => {
  const pA = projects.create({ name: 'Alpha', domain: 'engineering' });
  const pB = projects.create({ name: 'Beta',  domain: 'finance' });
  memory.add({ title: 'Alpha uses Postgres', content: 'Alpha stores data in PostgreSQL.', memory_type: 'project', project_id: pA.id });
  memory.add({ title: 'Beta uses Oracle',   content: 'Beta runs on Oracle DB.',          memory_type: 'project', project_id: pB.id });

  const aOnly = memory.list({ project_id: pA.id });
  const bOnly = memory.list({ project_id: pB.id });

  assert(aOnly.every(m => m.project_id === pA.id), 'Alpha list must only contain Alpha memories');
  assert(bOnly.every(m => m.project_id === pB.id), 'Beta list must only contain Beta memories');
  assert(!aOnly.some(m => m.title === 'Beta uses Oracle'), 'Beta memory must not appear in Alpha list');
});

// ── Test 3: Ambiguous task — multiple projects match ───────────────────────
test('3. Ambiguous task — search returns memories from multiple projects', () => {
  const p1 = projects.create({ name: 'Gamma Data', domain: 'data' });
  const p2 = projects.create({ name: 'Delta Data', domain: 'data' });
  memory.add({ title: 'Gamma reconciliation query', content: 'SELECT * FROM gamma_orders', memory_type: 'project', project_id: p1.id });
  memory.add({ title: 'Delta reconciliation query', content: 'SELECT * FROM delta_orders', memory_type: 'project', project_id: p2.id });

  const results = search('reconciliation query');
  const projectsFound = new Set(results.filter(r => r.project_id).map(r => r.project_id));
  assert(projectsFound.size >= 2, `Expected ≥2 projects in results, got ${projectsFound.size}`);
});

// ── Test 4: Contradictory memories ─────────────────────────────────────────
test('4. Contradictory memories — both visible, conflict preserved', () => {
  const m1 = memory.add({ title: 'API limit v1', content: 'Rate limit: 100 calls/min.', memory_type: 'semantic', trust_level: 'OBSERVED' });
  const m2 = memory.add({ title: 'API limit v2', content: 'Rate limit: 200 calls/min.', memory_type: 'semantic', trust_level: 'SOURCE_VERIFIED' });

  memory.update(m1.id, { trust_level: 'CONFLICTED' });

  const conflicted = memory.list({ trust_level: 'CONFLICTED' });
  const verified   = memory.list({ trust_level: 'SOURCE_VERIFIED' });

  assert(conflicted.some(m => m.id === m1.id), 'Conflicted memory must still be listed');
  assert(verified.some(m => m.id === m2.id),   'Source-verified memory must coexist');
});

// ── Test 5: Historical fact with valid_until ───────────────────────────────
test('5. Historical fact — stored with valid_until and OUTDATED trust', () => {
  const past = Date.now() - 86_400_000; // yesterday
  const m = memory.add({
    title: 'Old rate limit 50/min',
    content: 'Rate limit was 50 calls/min until 2026-01-01.',
    memory_type: 'semantic',
    trust_level: 'OUTDATED',
    valid_from:  Date.now() - 86_400_000 * 365,
    valid_until: past,
  });
  const got = memory.get(m.id);
  assert(got,                               'Historical memory must be retrievable');
  assert(got.valid_until < Date.now(),      'valid_until must be in the past');
  assert.strictEqual(got.trust_level, 'OUTDATED');
});

// ── Test 6: Skill retrieval by task intent ─────────────────────────────────
test('6. Skill retrieval — found by task intent, not skill name', () => {
  memory.add({
    title: 'SQL join validation skill',
    content: 'When a query double-counts rows: 1) check for missing join key uniqueness, 2) add DISTINCT, 3) use subquery to pre-aggregate.',
    memory_type: 'skill',
    trust_level: 'USER_CONFIRMED',
    importance: 9,
    tags: ['sql', 'joins', 'debugging'],
    retrieval_keywords: 'double counting duplicate rows join validation cartesian',
  });

  const results = search('why is my query double counting duplicate rows');
  assert(results.length > 0, 'Search must return results');
  assert(results.some(r => r.memory_type === 'skill'), 'A skill must appear in results');
});

// ── Test 7: Unknown information returns empty ──────────────────────────────
test('7. Unknown information — search returns empty for nonsense query', () => {
  const results = search('xyzzy_completely_unknown_term_12345_nonexistent');
  assert.strictEqual(results.length, 0, 'Unknown query must return no results');
});

// ── Test 8: Context contamination prevention ───────────────────────────────
test('8. Context contamination — domain filter excludes unrelated memories', () => {
  const p = projects.create({ name: 'Travel 2027', domain: 'personal' });
  memory.add({ title: 'Flight booking tip', content: 'Book 6 weeks early for best prices.', memory_type: 'project', project_id: p.id, domain: 'personal' });

  const workResults = search('booking', { domain: 'engineering' });
  assert(!workResults.some(m => m.domain === 'personal'), 'Work domain search must not return personal memories');
});

// ── Test 9: Session continuity — data persists across module reload ─────────
test('9. Session continuity — memories survive DB close/reopen', () => {
  const proj = projects.create({ name: 'Continuity Test', objective: 'Persist across sessions' });
  const mem  = memory.add({ title: 'Continuity probe', content: 'Should survive a DB reopen.', memory_type: 'project', project_id: proj.id });

  // Close and reopen the connection
  const { closeDb } = require('../src/db');
  closeDb();

  const gotProject = projects.get(proj.id);
  const gotMemory  = memory.get(mem.id);

  assert(gotProject,                              'Project must persist after close/reopen');
  assert(gotMemory,                               'Memory must persist after close/reopen');
  assert.strictEqual(gotProject.name, 'Continuity Test');
  assert.strictEqual(gotMemory.title, 'Continuity probe');
});

// ── Test 10: Secret scanner blocks credential ingestion ───────────────────
test('10. Secret scanner — blocks OpenAI key in content', () => {
  let threw = false;
  try {
    memory.add({
      title: 'Accidental API key',
      content: 'Here is my key: sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh',
      memory_type: 'semantic',
    });
  } catch (e) {
    threw = true;
    assert(e.message.includes('Secret detected'), `Expected "Secret detected" in error, got: ${e.message}`);
  }
  assert(threw, 'Secret scanner must throw on credential pattern');
});

// ── Cleanup & summary ──────────────────────────────────────────────────────
const { closeDb } = require('../src/db');
closeDb();
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);

console.log(`\n${pass + fail} tests: ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
