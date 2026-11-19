'use strict';
// HIVE Phase 18 — Search history tests.
// Run: node tests/test-phase18.js

const assert = require('assert');
const path   = require('path');
const fs     = require('fs');
const http   = require('http');

const TEST_DB = path.join(__dirname, '..', 'database', 'hive-p18-test.db');
process.env.HIVE_DB = TEST_DB;

fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);

const memory = require('../src/memory');
const { getDb, closeDb } = require('../src/db');
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

console.log('\nHIVE — Phase 18 search history tests\n');

const srv = createServer();
srv.listen(0);
const port = srv.address().port;

memory.add({ title: 'Node event loop', content: 'The event loop processes async callbacks.', memory_type: 'domain' });

(async () => {

  // H-1: search_history table exists in schema
  await test('H-1. schema v5 — search_history table exists', () => {
    const row = getDb().prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='search_history'").get();
    assert(row, 'search_history table must exist');
  });

  // H-2: GET /api/search/history returns empty array initially
  await test('H-2. GET /api/search/history — empty initially', async () => {
    const r = await get(port, '/api/search/history');
    assert.strictEqual(r.status, 200);
    const d = JSON.parse(r.body);
    assert(Array.isArray(d), 'must return array');
    assert.strictEqual(d.length, 0, 'must be empty before any searches');
  });

  // H-3: searching records a query in history
  await test('H-3. GET /api/search — records query in history', async () => {
    await get(port, '/api/search?q=event+loop&mode=keyword');
    const r = await get(port, '/api/search/history');
    const d = JSON.parse(r.body);
    assert(d.some(h => h.query === 'event loop'), 'query must appear in history');
  });

  // H-4: history entries have query, last_used, times fields
  await test('H-4. GET /api/search/history — entries have required fields', async () => {
    const r = await get(port, '/api/search/history');
    const d = JSON.parse(r.body);
    assert(d.length > 0);
    const h = d[0];
    assert('query' in h, 'must have query');
    assert('last_used' in h, 'must have last_used');
    assert('times' in h, 'must have times');
  });

  // H-5: same query searched twice — times count increases
  await test('H-5. repeated query — times count increments', async () => {
    await get(port, '/api/search?q=event+loop&mode=keyword');
    const r = await get(port, '/api/search/history');
    const d = JSON.parse(r.body);
    const entry = d.find(h => h.query === 'event loop');
    assert(entry, 'must find query');
    assert(entry.times >= 2, `times must be >= 2, got ${entry.times}`);
  });

  // H-6: different queries each appear separately
  await test('H-6. two distinct queries — both appear in history', async () => {
    await get(port, '/api/search?q=async&mode=keyword');
    const r = await get(port, '/api/search/history');
    const d = JSON.parse(r.body);
    assert(d.some(h => h.query === 'event loop'), 'first query must be in history');
    assert(d.some(h => h.query === 'async'), 'second query must be in history');
  });

  // H-7: empty query is NOT recorded
  await test('H-7. empty query — not recorded in history', async () => {
    const before = JSON.parse((await get(port, '/api/search/history')).body).length;
    await get(port, '/api/search?q=&mode=keyword');
    const after = JSON.parse((await get(port, '/api/search/history')).body).length;
    assert.strictEqual(after, before, 'empty query must not add a history entry');
  });

  // H-8: limit param is respected
  await test('H-8. GET /api/search/history?limit=1 — returns at most 1 entry', async () => {
    const r = await get(port, '/api/search/history?limit=1');
    const d = JSON.parse(r.body);
    assert(d.length <= 1, 'limit=1 must return at most 1 entry');
  });

  // H-9: dashboard HTML has datalist element wired to search input
  await test('H-9. GET / — HTML has datalist#q-history wired to input', async () => {
    const r = await get(port, '/');
    assert(r.body.includes('id="q-history"'), 'must include datalist#q-history');
    assert(r.body.includes('list="q-history"'), 'search input must reference the datalist');
  });

  // H-10: dashboard HTML includes loadHistory function
  await test('H-10. GET / — HTML has loadHistory function', async () => {
    const r = await get(port, '/');
    assert(r.body.includes('loadHistory'), 'must include loadHistory function');
    assert(r.body.includes('/api/search/history'), 'must call /api/search/history endpoint');
  });

  // ── Cleanup ───────────────────────────────────────────────────────────────
  srv.close();
  closeDb();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  console.log(`\n${pass + fail} tests: ${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);

})();
