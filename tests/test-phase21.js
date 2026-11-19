'use strict';
// HIVE Phase 21 — Bulk operations tests.
// Run: node tests/test-phase21.js

const assert = require('assert');
const path   = require('path');
const fs     = require('fs');
const http   = require('http');

const TEST_DB = path.join(__dirname, '..', 'database', 'hive-p21-test.db');
process.env.HIVE_DB = TEST_DB;

fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);

const memory = require('../src/memory');
const { closeDb } = require('../src/db');
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

function post(port, urlPath, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = http.request({
      hostname: '127.0.0.1', port, path: urlPath, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    });
    req.on('error', reject);
    req.write(data); req.end();
  });
}

console.log('\nHIVE — Phase 21 bulk operations tests\n');

const srv = createServer();
srv.listen(0);
const port = srv.address().port;

// Seed memories
const m1 = memory.add({ title: 'Bulk one',   content: 'First.', memory_type: 'episodic' });
const m2 = memory.add({ title: 'Bulk two',   content: 'Second.', memory_type: 'episodic' });
const m3 = memory.add({ title: 'Bulk three', content: 'Third.',  memory_type: 'semantic' });

(async () => {

  // B-1: POST /api/memories/bulk with archive action — returns count
  await test('B-1. POST /api/memories/bulk archive — returns {count:N}', async () => {
    const r = await post(port, '/api/memories/bulk', { ids: [m1.id], action: 'archive' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.count, 1, 'must report 1 archived');
  });

  // B-2: archived memories no longer appear in GET /api/memories
  await test('B-2. bulk archive — memory removed from active list', async () => {
    const r = await get(port, '/api/memories?limit=50');
    const list = JSON.parse(r.body);
    assert(!list.some(m => m.id === m1.id), 'archived memory must not appear in active list');
  });

  // B-3: bulk archive multiple ids at once
  await test('B-3. POST /api/memories/bulk archive — multiple ids', async () => {
    // Add fresh memories so we don't run out
    const a = memory.add({ title: 'BulkA', content: 'x.' });
    const b = memory.add({ title: 'BulkB', content: 'y.' });
    const r = await post(port, '/api/memories/bulk', { ids: [a.id, b.id], action: 'archive' });
    assert.strictEqual(r.body.count, 2, 'must report 2 archived');
    const list = JSON.parse((await get(port, '/api/memories?limit=50')).body);
    assert(!list.some(m => m.id === a.id || m.id === b.id), 'both must be archived');
  });

  // B-4: POST /api/memories/bulk update — changes memory_type
  await test('B-4. POST /api/memories/bulk update — changes memory_type', async () => {
    const r = await post(port, '/api/memories/bulk', { ids: [m2.id], action: 'update', updates: { memory_type: 'core' } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.count, 1);
    const updated = memory.get(m2.id);
    assert.strictEqual(updated.memory_type, 'core', 'memory_type must be updated');
  });

  // B-5: bulk update multiple ids
  await test('B-5. POST /api/memories/bulk update — multiple ids', async () => {
    const c = memory.add({ title: 'BulkC', content: 'z.', memory_type: 'episodic' });
    const d = memory.add({ title: 'BulkD', content: 'w.', memory_type: 'episodic' });
    const r = await post(port, '/api/memories/bulk', { ids: [c.id, d.id], action: 'update', updates: { memory_type: 'skill' } });
    assert.strictEqual(r.body.count, 2);
    assert.strictEqual(memory.get(c.id).memory_type, 'skill');
    assert.strictEqual(memory.get(d.id).memory_type, 'skill');
  });

  // B-6: missing ids returns 400
  await test('B-6. POST /api/memories/bulk — missing ids returns 400', async () => {
    const r = await post(port, '/api/memories/bulk', { action: 'archive' });
    assert.strictEqual(r.status, 400);
    assert(r.body.error, 'must return error message');
  });

  // B-7: missing action returns 400
  await test('B-7. POST /api/memories/bulk — missing action returns 400', async () => {
    const r = await post(port, '/api/memories/bulk', { ids: [m3.id] });
    assert.strictEqual(r.status, 400);
    assert(r.body.error, 'must return error message');
  });

  // B-8: empty ids array returns 400
  await test('B-8. POST /api/memories/bulk — empty ids array returns 400', async () => {
    const r = await post(port, '/api/memories/bulk', { ids: [], action: 'archive' });
    assert.strictEqual(r.status, 400);
  });

  // B-9: dashboard HTML has bulk toolbar elements
  await test('B-9. GET / — HTML has bulk-bar toolbar', async () => {
    const r = await get(port, '/');
    assert(r.body.includes('id="bulk-bar"'), 'must include bulk-bar div');
    assert(r.body.includes('bulkArchive'), 'must include bulkArchive function');
    assert(r.body.includes('bulkRetype'), 'must include bulkRetype function');
  });

  // B-10: dashboard HTML includes checkboxes in card template and toggleSel
  await test('B-10. GET / — HTML has toggleSel and checkbox in card', async () => {
    const r = await get(port, '/');
    assert(r.body.includes('toggleSel'), 'must include toggleSel function');
    assert(r.body.includes('type=checkbox'), 'card must include checkbox');
    assert(r.body.includes('/api/memories/bulk'), 'must call bulk endpoint');
  });

  // ── Cleanup ───────────────────────────────────────────────────────────────
  srv.close();
  closeDb();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  console.log(`\n${pass + fail} tests: ${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);

})();
