'use strict';
// HIVE Phase 13 — Memory editing (PUT + GET single) tests.
// Run: node tests/test-phase13.js

const assert = require('assert');
const path   = require('path');
const fs     = require('fs');
const http   = require('http');

const TEST_DB = path.join(__dirname, '..', 'database', 'hive-p13-test.db');
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

function request(port, method, urlPath, payload) {
  return new Promise((resolve, reject) => {
    const data = payload ? JSON.stringify(payload) : '';
    const req = http.request({
      hostname: '127.0.0.1', port, path: urlPath, method,
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

console.log('\nHIVE — Phase 13 memory editing tests\n');

const srv = createServer();
srv.listen(0);
const port = srv.address().port;

// Seed a memory to edit
const seed = memory.add({ title: 'Original Title', content: 'Original content', memory_type: 'semantic', trust_level: 'OBSERVED', importance: 5 });

(async () => {

  // E-1: GET /api/memories/:id returns the memory
  await test('E-1. GET /api/memories/:id — returns single memory', async () => {
    const r = await get(port, `/api/memories/${seed.id}`);
    assert.strictEqual(r.status, 200);
    const m = JSON.parse(r.body);
    assert.strictEqual(m.id, seed.id);
    assert.strictEqual(m.title, 'Original Title');
    assert.strictEqual(m.content, 'Original content');
  });

  // E-2: GET /api/memories/:id — unknown id returns 404
  await test('E-2. GET /api/memories/:id — non-existent id returns 404', async () => {
    const r = await get(port, '/api/memories/00000000-0000-0000-0000-000000000000');
    assert.strictEqual(r.status, 404);
  });

  // E-3: PUT /api/memories/:id updates the title
  await test('E-3. PUT /api/memories/:id — updates title', async () => {
    const r = await request(port, 'PUT', `/api/memories/${seed.id}`, { title: 'Updated Title' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.title, 'Updated Title');
  });

  // E-4: PUT /api/memories/:id updates the content
  await test('E-4. PUT /api/memories/:id — updates content', async () => {
    const r = await request(port, 'PUT', `/api/memories/${seed.id}`, { content: 'Updated content here' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.content, 'Updated content here');
  });

  // E-5: PUT /api/memories/:id updates multiple fields at once
  await test('E-5. PUT /api/memories/:id — updates multiple fields', async () => {
    const r = await request(port, 'PUT', `/api/memories/${seed.id}`, { memory_type: 'core', trust_level: 'USER_CONFIRMED', importance: 9 });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.memory_type, 'core');
    assert.strictEqual(r.body.trust_level, 'USER_CONFIRMED');
    assert.strictEqual(r.body.importance, 9);
  });

  // E-6: PUT /api/memories/:id — changes persist in DB
  await test('E-6. PUT /api/memories/:id — changes persist in DB', async () => {
    await request(port, 'PUT', `/api/memories/${seed.id}`, { title: 'Persisted Title' });
    const m = memory.get(seed.id);
    assert.strictEqual(m.title, 'Persisted Title');
  });

  // E-7: PUT non-existent id returns 404
  await test('E-7. PUT /api/memories/:id — non-existent id returns 404', async () => {
    const r = await request(port, 'PUT', '/api/memories/00000000-0000-0000-0000-000000000000', { title: 'Ghost' });
    assert.strictEqual(r.status, 404);
  });

  // E-8: PUT with no recognized fields returns 400
  await test('E-8. PUT /api/memories/:id — empty body returns 400', async () => {
    const r = await request(port, 'PUT', `/api/memories/${seed.id}`, {});
    assert.strictEqual(r.status, 400);
    assert(r.body.error, 'must return error message');
  });

  // E-9: Updated memory shows new title in GET /api/memories list
  await test('E-9. After PUT — updated title appears in GET /api/memories', async () => {
    await request(port, 'PUT', `/api/memories/${seed.id}`, { title: 'List Check Title' });
    const r = await get(port, '/api/memories');
    const list = JSON.parse(r.body);
    assert(list.some(m => m.title === 'List Check Title'), 'updated title must appear in list');
  });

  // E-10: Dashboard HTML contains the edit button markers
  await test('E-10. GET / — HTML contains edit UI elements', async () => {
    const r = await get(port, '/');
    assert(r.body.includes('showEdit'), 'HTML must include showEdit function');
    assert(r.body.includes('/api/memories/'), 'HTML must reference /api/memories/:id');
    assert(r.body.includes('Edit Memory'), 'modal must have "Edit Memory" heading');
  });

  // ── Cleanup ───────────────────────────────────────────────────────────────
  srv.close();
  closeDb();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  console.log(`\n${pass + fail} tests: ${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);

})();
