'use strict';
// HIVE Phase 25 — Duplicate detection tests.
// Run: node tests/test-phase25.js

const assert = require('assert');
const path   = require('path');
const fs     = require('fs');
const http   = require('http');

const TEST_DB = path.join(__dirname, '..', 'database', 'hive-p25-test.db');
process.env.HIVE_DB = TEST_DB;

fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);

const memory           = require('../src/memory');
const { similarity, findSimilar } = require('../src/dedupe');
const { closeDb }      = require('../src/db');
const { createServer } = require('../src/server');

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✅  ${name}`); pass++; }
  catch (e) { console.error(`  ❌  ${name}\n      ${e.message}`); fail++; }
}

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}${urlPath}`, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

console.log('\nHIVE — Phase 25 duplicate detection tests\n');

const srv = createServer();
srv.listen(0);
const port = srv.address().port;

// Seed a known memory
const m1 = memory.add({ title: 'JavaScript async await patterns', content: 'Async await is syntactic sugar over promises in JavaScript.' });

(async () => {

  // D-1: similarity returns high score for near-duplicate title+content
  await test('D-1. similarity — high score for near-duplicate', () => {
    const s = similarity(
      'JavaScript async await patterns',
      'Async await is syntactic sugar over promises in JavaScript.',
      'JavaScript async await patterns',
      'Async await is syntactic sugar over promises in JavaScript.'
    );
    assert(s >= 0.9, `expected >= 0.9, got ${s}`);
  });

  // D-2: similarity returns low score for unrelated content
  await test('D-2. similarity — low score for unrelated content', () => {
    const s = similarity(
      'React hooks tutorial',
      'useState and useEffect are React hooks for managing state.',
      'SQLite indexing strategies',
      'Covering indexes dramatically speed up SQLite queries on large tables.'
    );
    assert(s < 0.15, `expected < 0.15, got ${s}`);
  });

  // D-3: similarity is symmetric
  await test('D-3. similarity — symmetric (a,b) == (b,a)', () => {
    const s1 = similarity('async javascript', 'promises and callbacks', 'javascript async', 'callbacks and promises');
    const s2 = similarity('javascript async', 'callbacks and promises', 'async javascript', 'promises and callbacks');
    assert(Math.abs(s1 - s2) < 0.001, 'similarity must be symmetric');
  });

  // D-4: findSimilar returns the seeded memory for a near-duplicate
  await test('D-4. findSimilar — returns seeded memory for near-duplicate query', () => {
    const results = findSimilar('JavaScript async await patterns', 'Async await promises JavaScript sugar.');
    assert(results.length > 0, 'must find at least one similar memory');
    assert(results[0].id === m1.id, 'top result must be the seeded memory');
    assert(results[0]._score >= 0.25, 'score must exceed threshold');
  });

  // D-5: findSimilar returns empty for unrelated content
  await test('D-5. findSimilar — returns empty for unrelated content', () => {
    const results = findSimilar('Quantum entanglement physics', 'Photons exhibit non-local correlations via entanglement.');
    assert.strictEqual(results.length, 0, 'must return no matches for unrelated content');
  });

  // D-6: findSimilar respects custom threshold
  await test('D-6. findSimilar — respects threshold param', () => {
    const low  = findSimilar('JavaScript async', 'promises JavaScript', { threshold: 0.1 });
    const high = findSimilar('JavaScript async', 'promises JavaScript', { threshold: 0.9 });
    assert(low.length >= high.length, 'lower threshold must yield >= results');
  });

  // D-7: findSimilar results sorted by score descending
  await test('D-7. findSimilar — results sorted by score descending', () => {
    memory.add({ title: 'JavaScript promises guide', content: 'Promises are core to async JavaScript patterns.' });
    const results = findSimilar('JavaScript async await patterns', 'Async await promises JavaScript.');
    for (let i = 1; i < results.length; i++) {
      assert(results[i-1]._score >= results[i]._score, 'results must be sorted descending by score');
    }
  });

  // D-8: GET /api/memories/similar returns matches with score
  await test('D-8. GET /api/memories/similar — returns matches with score field', async () => {
    const q = encodeURIComponent('JavaScript async await patterns');
    const c = encodeURIComponent('Async await is sugar over promises in JavaScript.');
    const r = await get(port, `/api/memories/similar?title=${q}&content=${c}`);
    assert.strictEqual(r.status, 200);
    const d = JSON.parse(r.body);
    assert(Array.isArray(d), 'must return array');
    assert(d.length > 0, 'must find matches');
    assert('score' in d[0], 'each match must have score');
    assert('title' in d[0], 'each match must have title');
    assert(d[0].score >= 0 && d[0].score <= 1, 'score must be in [0,1]');
  });

  // D-9: GET /api/memories/similar with no content returns empty
  await test('D-9. GET /api/memories/similar — empty query returns empty array', async () => {
    const r = await get(port, '/api/memories/similar');
    assert.strictEqual(r.status, 200);
    const d = JSON.parse(r.body);
    assert.deepStrictEqual(d, []);
  });

  // D-10: dashboard HTML has duplicate warning panel and saveAnyway function
  await test('D-10. GET / — HTML has dup panel, saveAnyway, and dedupe check in submitAdd', async () => {
    const r = await get(port, '/');
    assert(r.body.includes('id="nm-dup"'),     'must have dup warning panel');
    assert(r.body.includes('saveAnyway'),       'must have saveAnyway function');
    assert(r.body.includes('/api/memories/similar'), 'submitAdd must call /api/memories/similar');
  });

  // ── Cleanup ───────────────────────────────────────────────────────────────
  srv.close();
  closeDb();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  console.log(`\n${pass + fail} tests: ${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);

})();
