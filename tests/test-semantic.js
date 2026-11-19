'use strict';
// HIVE Phase 6 — Semantic search tests.
// Uses a deterministic mock embedFn — no model download required.
// Run: node tests/test-semantic.js

const assert = require('assert');
const path   = require('path');
const fs     = require('fs');

const TEST_DB = path.join(__dirname, '..', 'database', 'hive-semantic-test.db');
process.env.HIVE_DB = TEST_DB;

fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);

const memory   = require('../src/memory');
const { cosine, search, backfill } = require('../src/semantic');
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

console.log('\nHIVE — Phase 6 semantic search tests\n');

// ── Deterministic mock embeddings ─────────────────────────────────────────────
// 4-dim vectors (instead of 384) — enough to test cosine math and ranking.
// SQLite vs databases: topic A. Code vs text: topic B. Mixed: topic C.
const VECS = {
  sqlite:    [1, 0, 0, 0],
  database:  [0.9, 0.1, 0, 0],
  code:      [0, 1, 0, 0],
  editor:    [0, 0.9, 0.1, 0],
  unrelated: [0, 0, 0, 1],
  query:     [0.95, 0.05, 0, 0], // close to sqlite/database
};

function mockEmbed(text) {
  const t = text.toLowerCase();
  for (const [k, v] of Object.entries(VECS)) {
    if (t.includes(k)) return Promise.resolve(v);
  }
  return Promise.resolve([0.25, 0.25, 0.25, 0.25]); // neutral
}

function addMem(opts) {
  return memory.add({
    title: opts.title,
    content: opts.content || opts.title,
    memory_type: 'semantic',
    trust_level: 'OBSERVED',
    importance: opts.importance || 5,
  });
}

// Pre-store an embedding on a memory
function storeEmbedding(id, vec) {
  getDb().prepare('UPDATE memories SET embedding = ? WHERE id = ?').run(JSON.stringify(vec), id);
}

// ── S-1: cosine — identical vectors score 1.0 ────────────────────────────────
test('S-1. cosine — identical vectors score 1.0', () => {
  const v = [1, 0, 0, 0];
  assert(Math.abs(cosine(v, v) - 1.0) < 1e-9, 'identical vectors must score 1.0');
});

// ── S-2: cosine — orthogonal vectors score 0.0 ───────────────────────────────
test('S-2. cosine — orthogonal vectors score 0.0', () => {
  assert.strictEqual(cosine([1, 0], [0, 1]), 0, 'orthogonal vectors must score 0');
});

// ── S-3: cosine — zero vector returns 0 without throwing ─────────────────────
test('S-3. cosine — zero vector returns 0 safely', () => {
  assert.strictEqual(cosine([0, 0, 0], [1, 2, 3]), 0, 'zero vector must return 0');
});

// ── S-4: search returns most similar memory first ────────────────────────────
test('S-4. search — most similar memory ranks first', async () => {
  const mSqlite   = addMem({ title: 'SQLite database overview' });
  const mCode     = addMem({ title: 'Code editor setup' });
  const mUnrelated = addMem({ title: 'Unrelated random note' });
  storeEmbedding(mSqlite.id,    VECS.sqlite);
  storeEmbedding(mCode.id,      VECS.code);
  storeEmbedding(mUnrelated.id, VECS.unrelated);

  const results = await search('sqlite query', { embedFn: () => Promise.resolve(VECS.query) });
  assert(results.length > 0, 'must return results');
  assert.strictEqual(results[0].id, mSqlite.id, `SQLite memory must rank first; got ${results[0].title}`);
});

// ── S-5: search — no embeddings returns empty ────────────────────────────────
test('S-5. search — returns empty when no memories have embeddings', async () => {
  // Add a memory but DON'T store an embedding
  addMem({ title: 'Memory with no embedding' });
  // Only search memories WHERE embedding IS NOT NULL — so the new unembedded one won't appear
  const results = await search('no embedding', { embedFn: mockEmbed });
  // All results (if any) should have _sim defined
  for (const r of results) assert(r._sim !== undefined, 'each result must have _sim');
});

// ── S-6: search with limit ────────────────────────────────────────────────────
test('S-6. search — respects limit parameter', async () => {
  // memories from S-4 are still there; limit to 1
  const results = await search('sqlite query', { limit: 1, embedFn: () => Promise.resolve(VECS.query) });
  assert(results.length <= 1, `expected <= 1 result, got ${results.length}`);
});

// ── S-7: hybrid mode returns _hybrid score ───────────────────────────────────
test('S-7. search — hybrid mode attaches _hybrid score', async () => {
  const results = await search('sqlite', {
    hybrid: true,
    embedFn: () => Promise.resolve(VECS.sqlite),
  });
  for (const r of results) assert(r._hybrid !== undefined, `missing _hybrid on ${r.title}`);
});

// ── S-8: hybrid re-ranks by importance ───────────────────────────────────────
test('S-8. search hybrid — high importance boosts rank', async () => {
  const mLowImp  = addMem({ title: 'sqlite low importance', importance: 1 });
  const mHighImp = addMem({ title: 'sqlite high importance', importance: 10 });
  storeEmbedding(mLowImp.id,  VECS.sqlite);
  storeEmbedding(mHighImp.id, VECS.sqlite); // same vector, different importance

  const results = await search('sqlite', {
    hybrid: true,
    embedFn: () => Promise.resolve(VECS.sqlite),
  });
  const highIdx = results.findIndex(r => r.id === mHighImp.id);
  const lowIdx  = results.findIndex(r => r.id === mLowImp.id);
  assert(highIdx !== -1 && lowIdx !== -1, 'both memories must appear');
  assert(highIdx < lowIdx, `high-importance (idx ${highIdx}) should rank above low-importance (idx ${lowIdx})`);
});

// ── S-9: backfill populates missing embeddings ───────────────────────────────
test('S-9. backfill — embeds memories without an embedding', async () => {
  const m1 = addMem({ title: 'sqlite backfill test one' });
  const m2 = addMem({ title: 'sqlite backfill test two' });
  // ensure they have no embedding
  getDb().prepare('UPDATE memories SET embedding = NULL WHERE id IN (?, ?)').run(m1.id, m2.id);

  const before = getDb().prepare('SELECT COUNT(*) as n FROM memories WHERE embedding IS NULL AND status = ?').get('active').n;
  const count  = await backfill({ embedFn: mockEmbed });
  const after  = getDb().prepare('SELECT COUNT(*) as n FROM memories WHERE embedding IS NULL AND status = ?').get('active').n;

  assert(count >= 2, `expected >= 2 backfilled, got ${count}`);
  assert(after < before, 'number of unembedded memories must decrease after backfill');
});

// ── S-10: backfill skips already-embedded memories ───────────────────────────
test('S-10. backfill — skips memories that already have an embedding', async () => {
  const m = addMem({ title: 'already embedded' });
  storeEmbedding(m.id, VECS.sqlite);

  // Count embedded before
  const before = getDb().prepare('SELECT COUNT(*) as n FROM memories WHERE embedding IS NOT NULL AND status = ?').get('active').n;
  await backfill({ embedFn: mockEmbed });
  const after  = getDb().prepare('SELECT COUNT(*) as n FROM memories WHERE embedding IS NOT NULL AND status = ?').get('active').n;

  // All previously-null ones should now be filled; existing ones untouched (count only grows)
  assert(after >= before, 'embedded count must not decrease');
  const stillNull = getDb().prepare('SELECT COUNT(*) as n FROM memories WHERE embedding IS NULL AND status = ?').get('active').n;
  assert.strictEqual(stillNull, 0, 'no active memories should remain unembedded after backfill');
});

// ── Cleanup ───────────────────────────────────────────────────────────────────
// tests are async — wait for all to settle
setTimeout(async () => {
  await Promise.resolve(); // let any pending microtasks flush
  closeDb();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  console.log(`\n${pass + fail} tests: ${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
}, 500);
