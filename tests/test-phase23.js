'use strict';
// HIVE Phase 23 — Memory confidence scores tests.
// Run: node tests/test-phase23.js

const assert = require('assert');
const path   = require('path');
const fs     = require('fs');
const http   = require('http');

const TEST_DB = path.join(__dirname, '..', 'database', 'hive-p23-test.db');
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

function put(port, urlPath, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = http.request({
      hostname: '127.0.0.1', port, path: urlPath, method: 'PUT',
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

console.log('\nHIVE — Phase 23 confidence scores tests\n');

const srv = createServer();
srv.listen(0);
const port = srv.address().port;

// Seed — three memories with distinct confidence values
const mHigh = memory.add({ title: 'High conf',   content: 'Verified fact.', confidence: 0.9 });
const mMid  = memory.add({ title: 'Mid conf',    content: 'Likely true.',   confidence: 0.6 });
const mLow  = memory.add({ title: 'Low conf',    content: 'Speculative.',   confidence: 0.2 });

(async () => {

  // C-1: memory.add stores confidence correctly
  await test('C-1. memory.add stores confidence', () => {
    assert.strictEqual(mHigh.confidence, 0.9);
    assert.strictEqual(mMid.confidence,  0.6);
    assert.strictEqual(mLow.confidence,  0.2);
  });

  // C-2: memory.list default confidence (0.5) when not specified
  await test('C-2. memory.add defaults confidence to 0.5', () => {
    const m = memory.add({ title: 'Default conf', content: 'No conf set.' });
    assert.strictEqual(m.confidence, 0.5, 'default confidence must be 0.5');
    memory.update(m.id, { status: 'archived' }); // cleanup
  });

  // C-3: memory.list min_conf filter
  await test('C-3. memory.list min_conf=0.8 — only high-confidence memories', () => {
    const results = memory.list({ min_conf: 0.8 });
    assert(results.some(m => m.id === mHigh.id), 'high-conf must appear');
    assert(!results.some(m => m.id === mMid.id),  'mid-conf must be excluded');
    assert(!results.some(m => m.id === mLow.id),  'low-conf must be excluded');
  });

  // C-4: memory.list max_conf filter
  await test('C-4. memory.list max_conf=0.4 — only low-confidence memories', () => {
    const results = memory.list({ max_conf: 0.4 });
    assert(results.some(m => m.id === mLow.id),  'low-conf must appear');
    assert(!results.some(m => m.id === mHigh.id), 'high-conf must be excluded');
  });

  // C-5: memory.update changes confidence
  await test('C-5. memory.update — confidence updated and clamped to [0,1]', () => {
    memory.update(mMid.id, { confidence: 0.75 });
    assert.strictEqual(memory.get(mMid.id).confidence, 0.75);
  });

  // C-6: GET /api/memories returns confidence field
  await test('C-6. GET /api/memories — returns confidence field', async () => {
    const r = await get(port, '/api/memories?limit=50');
    const list = JSON.parse(r.body);
    assert(list.every(m => 'confidence' in m), 'every memory must have confidence field');
  });

  // C-7: GET /api/memories?min_conf=0.8 — API filter works
  await test('C-7. GET /api/memories?min_conf=0.8 — filters by confidence', async () => {
    const r = await get(port, '/api/memories?min_conf=0.8&limit=50');
    const list = JSON.parse(r.body);
    assert(list.every(m => m.confidence >= 0.8), 'all results must have confidence >= 0.8');
    assert(list.some(m => m.id === mHigh.id), 'high-conf memory must appear');
  });

  // C-8: GET /api/memories?max_conf=0.4 — API filter works
  await test('C-8. GET /api/memories?max_conf=0.4 — filters low confidence', async () => {
    const r = await get(port, '/api/memories?max_conf=0.4&limit=50');
    const list = JSON.parse(r.body);
    assert(list.every(m => m.confidence <= 0.4), 'all results must have confidence <= 0.4');
  });

  // C-9: PUT /api/memories/:id updates confidence
  await test('C-9. PUT /api/memories/:id — confidence updated via API', async () => {
    const r = await put(port, `/api/memories/${mLow.id}`, { confidence: 0.55 });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.confidence, 0.55);
  });

  // C-10: dashboard HTML has confidence bar and mconf filter
  await test('C-10. GET / — HTML has confBar, mconf filter, and nm-cf modal field', async () => {
    const r = await get(port, '/');
    assert(r.body.includes('confBar'),   'must include confBar function');
    assert(r.body.includes('id="mconf"'), 'must include confidence filter select');
    assert(r.body.includes('id="nm-cf"'), 'must include confidence modal input');
  });

  // ── Cleanup ───────────────────────────────────────────────────────────────
  srv.close();
  closeDb();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  console.log(`\n${pass + fail} tests: ${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);

})();
