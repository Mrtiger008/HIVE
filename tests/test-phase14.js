'use strict';
// HIVE Phase 14 — Semantic search toggle tests.
// Run: node tests/test-phase14.js

const assert = require('assert');
const path   = require('path');
const fs     = require('fs');
const http   = require('http');

const TEST_DB = path.join(__dirname, '..', 'database', 'hive-p14-test.db');
process.env.HIVE_DB = TEST_DB;

fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);

const memory = require('../src/memory');
const { createServer } = require('../src/server');
const { getDb, closeDb } = require('../src/db');

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

console.log('\nHIVE — Phase 14 semantic search toggle tests\n');

const srv = createServer();
srv.listen(0);
const port = srv.address().port;

// Seed a few memories
memory.add({ title: 'Node.js event loop', content: 'The event loop processes async callbacks in phases.', memory_type: 'domain' });
memory.add({ title: 'SQLite FTS5 search', content: 'Full-text search with BM25 ranking in SQLite.', memory_type: 'skill' });
memory.add({ title: 'Team standup notes', content: 'Discussed sprint velocity and blockers.', memory_type: 'episodic' });

(async () => {

  // S-1: keyword mode returns FTS5 results
  await test('S-1. keyword mode — matches by token', async () => {
    const r = await get(port, '/api/search?q=event+loop&mode=keyword');
    assert.strictEqual(r.status, 200);
    const d = JSON.parse(r.body);
    assert(Array.isArray(d), 'must return array');
    assert(d.length > 0, 'must find event loop memory');
    assert(d.some(m => m.title.includes('event loop')), 'title must match');
  });

  // S-2: default (no mode param) behaves as keyword
  await test('S-2. default (no mode) — same as keyword', async () => {
    const r = await get(port, '/api/search?q=SQLite');
    assert.strictEqual(r.status, 200);
    const d = JSON.parse(r.body);
    assert(Array.isArray(d));
    assert(d.some(m => m.title.includes('SQLite')));
  });

  // S-3: semantic mode returns array (falls back to keyword when no embeddings)
  await test('S-3. semantic mode — returns array (fallback ok)', async () => {
    const r = await get(port, '/api/search?q=async+javascript&mode=semantic');
    assert.strictEqual(r.status, 200);
    const d = JSON.parse(r.body);
    assert(Array.isArray(d), 'must return array even without embeddings');
  });

  // S-4: hybrid mode returns array (falls back to keyword when no embeddings)
  await test('S-4. hybrid mode — returns array (fallback ok)', async () => {
    const r = await get(port, '/api/search?q=database+search&mode=hybrid');
    assert.strictEqual(r.status, 200);
    const d = JSON.parse(r.body);
    assert(Array.isArray(d), 'must return array even without embeddings');
  });

  // S-5: empty query returns empty array for all modes
  await test('S-5. empty query — returns empty array regardless of mode', async () => {
    for (const mode of ['keyword', 'semantic', 'hybrid']) {
      const r = await get(port, `/api/search?q=&mode=${mode}`);
      assert.strictEqual(r.status, 200, `mode=${mode}`);
      assert.deepStrictEqual(JSON.parse(r.body), [], `mode=${mode} must be []`);
    }
  });

  // S-6: keyword mode respects limit param
  await test('S-6. keyword mode — limit param respected', async () => {
    const r = await get(port, '/api/search?q=the&limit=1&mode=keyword');
    assert.strictEqual(r.status, 200);
    const d = JSON.parse(r.body);
    assert(d.length <= 1, 'limit=1 must return at most 1 result');
  });

  // S-7: unknown mode falls back to keyword gracefully
  await test('S-7. unknown mode — falls back to keyword', async () => {
    const r = await get(port, '/api/search?q=event&mode=bogus');
    assert.strictEqual(r.status, 200);
    const d = JSON.parse(r.body);
    assert(Array.isArray(d), 'must return array for unknown mode');
  });

  // S-8: search results include expected memory fields
  await test('S-8. keyword search result — has id, title, content fields', async () => {
    const r = await get(port, '/api/search?q=standup&mode=keyword');
    assert.strictEqual(r.status, 200);
    const d = JSON.parse(r.body);
    assert(d.length > 0, 'must find standup memory');
    const m = d[0];
    assert(m.id, 'must have id');
    assert(m.title, 'must have title');
    assert(m.content, 'must have content');
  });

  // S-9: dashboard HTML contains the smode select element
  await test('S-9. GET / — HTML has search mode selector', async () => {
    const r = await get(port, '/');
    assert(r.body.includes('id="smode"'), 'must include smode select');
    assert(r.body.includes('Keyword'), 'must include Keyword option');
    assert(r.body.includes('Semantic'), 'must include Semantic option');
    assert(r.body.includes('Hybrid'), 'must include Hybrid option');
  });

  // S-10: dashboard doSearch wires smode into API call
  await test('S-10. GET / — doSearch references smode and mode param', async () => {
    const r = await get(port, '/');
    assert(r.body.includes("g('smode').value"), 'must read smode value');
    assert(r.body.includes('&mode='), 'must append mode param to search URL');
  });

  // ── Cleanup ───────────────────────────────────────────────────────────────
  srv.close();
  closeDb();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  console.log(`\n${pass + fail} tests: ${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);

})();
