'use strict';
// HIVE Phase 7 — Smart Briefings tests.
// Uses deterministic mock embedFn — no model download required.
// Run: node tests/test-briefing.js

const assert = require('assert');
const path   = require('path');
const fs     = require('fs');

const TEST_DB = path.join(__dirname, '..', 'database', 'hive-briefing-test.db');
process.env.HIVE_DB = TEST_DB;

fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);

const memory   = require('../src/memory');
const projects = require('../src/projects');
const { generateBriefing, dailyBriefing } = require('../src/briefing');
const { getDb, closeDb } = require('../src/db');

let pass = 0, fail = 0;

function test(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r.then(() => { console.log(`  ✅  ${name}`); pass++; })
              .catch(e => { console.error(`  ❌  ${name}\n      ${e.message}`); fail++; });
    }
    console.log(`  ✅  ${name}`); pass++;
  } catch (e) { console.error(`  ❌  ${name}\n      ${e.message}`); fail++; }
}

console.log('\nHIVE — Phase 7 smart briefing tests\n');

// ── Helpers ──────────────────────────────────────────────────────────────────

const VECS = {
  sqlite:  [1, 0, 0, 0],
  code:    [0, 1, 0, 0],
  neutral: [0.25, 0.25, 0.25, 0.25],
};

function mockEmbed(text) {
  const t = text.toLowerCase();
  if (t.includes('sqlite')) return Promise.resolve(VECS.sqlite);
  if (t.includes('code'))   return Promise.resolve(VECS.code);
  return Promise.resolve(VECS.neutral);
}

function addMem(opts) {
  return memory.add({
    title:       opts.title,
    content:     opts.content || opts.title,
    memory_type: opts.type || 'semantic',
    trust_level: 'OBSERVED',
    importance:  opts.importance || 5,
    project_id:  opts.project_id || null,
  });
}

function storeEmbedding(id, vec) {
  getDb().prepare('UPDATE memories SET embedding = ? WHERE id = ?').run(JSON.stringify(vec), id);
}

function setLastAccessed(id, msAgo) {
  const ts = Date.now() - msAgo;
  getDb().prepare('UPDATE memories SET last_accessed_at = ?, created_at = ? WHERE id = ?').run(ts, ts, id);
}

// ── B-1: generateBriefing — returns markdown with section headers ─────────────
test('B-1. generateBriefing — returns markdown with section headers', async () => {
  addMem({ title: 'SQLite database overview', content: 'SQLite is a lightweight database engine.' });
  const r = await generateBriefing('sqlite', { embedFn: mockEmbed });
  assert(typeof r.text === 'string', 'text must be string');
  assert(r.text.includes('# HIVE Briefing: sqlite'), `missing title header; got:\n${r.text}`);
  assert(r.text.includes('## Relevant Memories'), 'missing Relevant Memories section');
  assert(typeof r.tokenEstimate === 'number' && r.tokenEstimate > 0, 'tokenEstimate must be > 0');
  assert(typeof r.memoryCount === 'number', 'memoryCount must be number');
});

// ── B-2: deduplication — a memory in both KW+semantic appears only once ───────
test('B-2. generateBriefing — deduplicates KW and semantic results', async () => {
  const m = addMem({ title: 'sqlite unique dedup test', content: 'sqlite dedup content unique' });
  storeEmbedding(m.id, VECS.sqlite);

  const r = await generateBriefing('sqlite unique dedup test', { embedFn: mockEmbed });
  // Count bold memory title entries (not the header which also contains the query text)
  const matches = (r.text.match(/\*\*\[semantic\] sqlite unique dedup test\*\*/g) || []).length;
  assert.strictEqual(matches, 1, `bold memory title appeared ${matches} times; expected exactly 1 (dedup failed)`);
});

// ── B-3: budget enforcement — stays within token budget ───────────────────────
test('B-3. generateBriefing — respects token budget', async () => {
  for (let i = 0; i < 5; i++) {
    addMem({
      title:   `Budget test memory number ${i}`,
      content: 'x'.repeat(300), // ~75 tokens each
    });
  }
  // Budget of 100 tokens — header+section take ~15 tokens; can't fit all 5 memories
  const r = await generateBriefing('budget test memory', { budget: 100, embedFn: mockEmbed });
  // tokenEstimate may slightly exceed budget due to fixed-overhead headers
  // but the number of memory entries in text should be fewer than 5
  const entryCount = (r.text.match(/\*\*\[semantic\]/g) || []).length;
  assert(entryCount < 5, `expected < 5 entries under tight budget, got ${entryCount}`);
});

// ── B-4: no matches — returns no-memories message ────────────────────────────
test('B-4. generateBriefing — empty state message when no memories match', async () => {
  // FTS5: "xyzqnomatch" doesn't appear in any memory title/content.
  // Semantic: use [0,0,1,0] which is orthogonal to all stored embeddings ([1,0,0,0] and [0,1,0,0]),
  //   so cosine = 0 → no semantic results either.
  const r = await generateBriefing('xyzqnomatch', { embedFn: () => Promise.resolve([0, 0, 1, 0]) });
  assert(r.text.includes('*No relevant memories found.*'), `expected empty-state message; got:\n${r.text}`);
  assert.strictEqual(r.memoryCount, 0, 'memoryCount must be 0');
});

// ── B-5: stale memories surface in "Needs Review" ────────────────────────────
test('B-5. generateBriefing — surfaces stale memories in Needs Review', async () => {
  const old = addMem({ title: 'Very old stale memory five', content: 'ancient stale content five' });
  setLastAccessed(old.id, 20 * 86400000); // 20 days ago

  // task=null → kwResults=[], semResults=[] → seen={} → all stale memories from stalest() surface
  const r = await generateBriefing(null, { embedFn: mockEmbed });
  assert(r.text.includes('## Needs Review'), `expected Needs Review section; got:\n${r.text}`);
  assert(r.text.includes('Very old stale memory five'), 'stale memory should appear in Needs Review');
  assert(r.staleCount > 0, 'staleCount must be > 0');
});

// ── B-6: stale memory in main results doesn't repeat in Needs Review ──────────
test('B-6. generateBriefing — stale but already-surfaced memory excluded from Needs Review', async () => {
  const m = addMem({ title: 'sqlite stale but relevant', content: 'sqlite relevant old memory' });
  setLastAccessed(m.id, 20 * 86400000); // 20 days ago — qualifies as stale
  storeEmbedding(m.id, VECS.sqlite);

  const r = await generateBriefing('sqlite stale but relevant', { embedFn: mockEmbed });
  // The memory may appear in Relevant Memories OR Needs Review, but NOT both
  const inRelevant    = r.text.includes('**[semantic] sqlite stale but relevant**');
  const inNeedsReview = r.text.includes('- **sqlite stale but relevant**');
  assert(!(inRelevant && inNeedsReview), 'memory must not appear in both sections');
});

// ── B-7: dailyBriefing — infers topic from recent patterns ───────────────────
test('B-7. dailyBriefing — returns a briefing inferred from recent activity', async () => {
  for (let i = 0; i < 3; i++) {
    addMem({ title: `patterns daily topic ${i}`, content: 'patterns daily topic recurring keyword' });
  }
  const r = await dailyBriefing({ embedFn: mockEmbed });
  assert(typeof r.text === 'string' && r.text.length > 0, 'text must be non-empty');
  assert(r.text.startsWith('# HIVE'), 'must have HIVE header');
  assert(typeof r.tokenEstimate === 'number', 'tokenEstimate must be number');
});

// ── B-8: ranking — keyword+semantic match ranks above semantic-only ───────────
test('B-8. generateBriefing — keyword+semantic match ranks above semantic-only', async () => {
  // mA: matches FTS5 on "sqlite" AND has sqlite embedding
  const mA = addMem({ title: 'sqlite full match memory', content: 'sqlite full match content' });
  // mB: does NOT match FTS5 on "sqlite" but has sqlite embedding
  const mB = addMem({ title: 'completely unrelated title zzz', content: 'completely unrelated content zzz' });
  storeEmbedding(mA.id, VECS.sqlite);
  storeEmbedding(mB.id, VECS.sqlite); // same vector

  const r = await generateBriefing('sqlite full match', { embedFn: mockEmbed });
  const idxA = r.text.indexOf('sqlite full match memory');
  const idxB = r.text.indexOf('completely unrelated title zzz');
  assert(idxA !== -1 && idxB !== -1, 'both memories must appear in briefing');
  assert(idxA < idxB, `keyword+semantic match (pos ${idxA}) should rank before semantic-only (pos ${idxB})`);
});

// ── B-9: projectId filter — isolates memories by project ─────────────────────
test('B-9. generateBriefing — project filter returns only that project\'s memories', async () => {
  const pA = projects.create({ name: 'Project Alpha', domain: 'software-engineering' });
  const pB = projects.create({ name: 'Project Beta',  domain: 'software-engineering' });
  addMem({ title: 'alpha specific memory unique', content: 'alpha project content', project_id: pA.id });
  addMem({ title: 'beta specific memory unique',  content: 'beta project content',  project_id: pB.id });

  const r = await generateBriefing('unique memory', { projectId: pA.id, embedFn: mockEmbed });
  assert(r.text.includes('alpha specific memory unique'), 'Alpha memory must appear');
  assert(!r.text.includes('beta specific memory unique'), 'Beta memory must NOT appear');
});

// ── B-10: null task — returns "# HIVE Daily Briefing" header ─────────────────
test('B-10. generateBriefing — null task returns daily briefing header', async () => {
  const r = await generateBriefing(null, { embedFn: mockEmbed });
  assert(r.text.startsWith('# HIVE Daily Briefing'), `expected daily briefing header; got: ${r.text.slice(0, 60)}`);
  assert(!r.text.includes('# HIVE Briefing:'), 'should NOT have task-specific header');
});

// ── Cleanup ───────────────────────────────────────────────────────────────────
setTimeout(async () => {
  await Promise.resolve();
  closeDb();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  console.log(`\n${pass + fail} tests: ${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
}, 500);
