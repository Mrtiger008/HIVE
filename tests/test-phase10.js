'use strict';
// HIVE Phase 10 — Write API + Auto-embed tests.
// Run: node tests/test-phase10.js

const assert = require('assert');
const path   = require('path');
const fs     = require('fs');
const http   = require('http');

const TEST_DB = path.join(__dirname, '..', 'database', 'hive-p10-test.db');
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

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}${urlPath}`, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

function post(port, urlPath, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = http.request({ hostname: '127.0.0.1', port, path: urlPath, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      res => {
        let body = '';
        res.on('data', c => { body += c; });
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
      });
    req.on('error', reject);
    req.write(data); req.end();
  });
}

function del(port, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: urlPath, method: 'DELETE' },
      res => {
        let body = '';
        res.on('data', c => { body += c; });
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
      });
    req.on('error', reject);
    req.end();
  });
}

// ── Server ────────────────────────────────────────────────────────────────────

console.log('\nHIVE — Phase 10 write API + auto-embed tests\n');

const srv = createServer();
srv.listen(0);
const port = srv.address().port;

(async () => {

  // P-1: POST /api/memories creates a memory
  await test('P-1. POST /api/memories — creates memory and returns 201', async () => {
    const r = await post(port, '/api/memories', { title: 'P10 test alpha', content: 'Content for P10 alpha', memory_type: 'semantic', trust_level: 'OBSERVED', importance: 6 });
    assert.strictEqual(r.status, 201, `expected 201, got ${r.status}`);
    assert(r.body.id, 'must return id');
    assert.strictEqual(r.body.title, 'P10 test alpha');
    assert.strictEqual(r.body.memory_type, 'semantic');
  });

  // P-2: POST with missing title returns 400
  await test('P-2. POST /api/memories — missing title returns 400', async () => {
    const r = await post(port, '/api/memories', { content: 'No title here' });
    assert.strictEqual(r.status, 400, `expected 400, got ${r.status}`);
    assert(r.body.error, 'must return error message');
  });

  // P-3: POST with missing content returns 400
  await test('P-3. POST /api/memories — missing content returns 400', async () => {
    const r = await post(port, '/api/memories', { title: 'No content' });
    assert.strictEqual(r.status, 400);
  });

  // P-4: POST then GET /api/memories shows new memory
  await test('P-4. POST /api/memories — new memory appears in GET /api/memories', async () => {
    await post(port, '/api/memories', { title: 'P10 visible check', content: 'P10 visibility test content' });
    const r = await get(port, '/api/memories');
    const list = JSON.parse(r.body);
    assert(list.some(m => m.title === 'P10 visible check'), 'new memory must appear in list');
  });

  // P-5: POST then /api/stats increases count
  await test('P-5. POST /api/memories — stats count increases', async () => {
    const before = JSON.parse((await get(port, '/api/stats')).body).memories;
    await post(port, '/api/memories', { title: 'P10 stats check', content: 'Stats increment test' });
    const after = JSON.parse((await get(port, '/api/stats')).body).memories;
    assert(after > before, `expected count to increase: ${before} → ${after}`);
  });

  // P-6: POST with type=core returns core memory
  await test('P-6. POST /api/memories — respects memory_type field', async () => {
    const r = await post(port, '/api/memories', { title: 'P10 core type', content: 'Core type test', memory_type: 'core' });
    assert.strictEqual(r.body.memory_type, 'core');
  });

  // P-7: DELETE /api/memories/:id archives a memory
  await test('P-7. DELETE /api/memories/:id — archives memory', async () => {
    const cr = await post(port, '/api/memories', { title: 'P10 to delete', content: 'Will be archived' });
    const id = cr.body.id;
    const dr = await del(port, `/api/memories/${id}`);
    assert.strictEqual(dr.status, 200, `expected 200, got ${dr.status}`);
    assert.strictEqual(dr.body.ok, true);
    const m = memory.get(id);
    assert.strictEqual(m.status, 'archived', `expected status=archived, got ${m.status}`);
  });

  // P-8: Archived memory no longer in /api/memories list
  await test('P-8. DELETE — archived memory disappears from GET /api/memories', async () => {
    const cr = await post(port, '/api/memories', { title: 'P10 gone check', content: 'Will be archived and hidden' });
    const id = cr.body.id;
    await del(port, `/api/memories/${id}`);
    const list = JSON.parse((await get(port, '/api/memories')).body);
    assert(!list.some(m => m.id === id), 'archived memory must not appear in active list');
  });

  // P-9: DELETE non-existent id returns 404
  await test('P-9. DELETE /api/memories/:id — non-existent id returns 404', async () => {
    const r = await del(port, '/api/memories/00000000-0000-0000-0000-000000000000');
    assert.strictEqual(r.status, 404, `expected 404, got ${r.status}`);
  });

  // P-10: memory.add() fires auto-embed (best-effort — verify no crash, embed may be null without model)
  await test('P-10. memory.add() — auto-embed fires without crashing', async () => {
    // The embedMemory call is fire-and-forget; without the model it silently fails.
    // Verify that memory.add() still returns a valid memory and doesn't throw.
    const m = memory.add({ title: 'P10 auto-embed test', content: 'Testing fire-and-forget embed', memory_type: 'semantic', trust_level: 'OBSERVED', importance: 5 });
    assert(m.id, 'memory.add() must return an id even when embedMemory fails');
    assert.strictEqual(m.title, 'P10 auto-embed test');
  });

  // ── Cleanup ───────────────────────────────────────────────────────────────
  srv.close();
  closeDb();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  console.log(`\n${pass + fail} tests: ${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);

})();
