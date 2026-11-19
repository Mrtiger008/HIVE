'use strict';
// HIVE Phase 19 — Memory tags UI tests.
// Run: node tests/test-phase19.js

const assert = require('assert');
const path   = require('path');
const fs     = require('fs');
const http   = require('http');

const TEST_DB = path.join(__dirname, '..', 'database', 'hive-p19-test.db');
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

function request(port, method, urlPath, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
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

console.log('\nHIVE — Phase 19 memory tags UI tests\n');

const srv = createServer();
srv.listen(0);
const port = srv.address().port;

// Seed memories with tags
const m1 = memory.add({ title: 'Tagged alpha', content: 'Has two tags.', tags: ['javascript', 'async'] });
const m2 = memory.add({ title: 'Tagged beta',  content: 'Has one tag.',  tags: ['javascript'] });
const m3 = memory.add({ title: 'No tags',      content: 'Plain memory.' });

(async () => {

  // T-1: GET /api/tags — returns tag list with counts
  await test('T-1. GET /api/tags — returns tags with counts', async () => {
    const r = await get(port, '/api/tags');
    assert.strictEqual(r.status, 200);
    const d = JSON.parse(r.body);
    assert(Array.isArray(d), 'must return array');
    const js = d.find(t => t.tag === 'javascript');
    assert(js, 'must include javascript tag');
    assert.strictEqual(js.count, 2, 'javascript appears in 2 memories');
  });

  // T-2: GET /api/tags — sorted by count descending
  await test('T-2. GET /api/tags — sorted by count desc', async () => {
    const r = await get(port, '/api/tags');
    const d = JSON.parse(r.body);
    for (let i = 1; i < d.length; i++) {
      assert(d[i-1].count >= d[i].count, 'must be sorted by count descending');
    }
  });

  // T-3: GET /api/memories?tag=javascript — filters to tagged memories
  await test('T-3. GET /api/memories?tag=javascript — returns tagged memories only', async () => {
    const r = await get(port, '/api/memories?tag=javascript');
    assert.strictEqual(r.status, 200);
    const d = JSON.parse(r.body);
    assert(d.every(m => (m.tags||[]).includes('javascript')), 'all results must have javascript tag');
    assert(d.some(m => m.id === m1.id), 'must include m1');
    assert(d.some(m => m.id === m2.id), 'must include m2');
    assert(!d.some(m => m.id === m3.id), 'must exclude untagged m3');
  });

  // T-4: GET /api/memories?tag=async — returns only the memory with that tag
  await test('T-4. GET /api/memories?tag=async — returns only matching memory', async () => {
    const r = await get(port, '/api/memories?tag=async');
    const d = JSON.parse(r.body);
    assert.strictEqual(d.length, 1);
    assert.strictEqual(d[0].id, m1.id);
  });

  // T-5: POST /api/memories with tags — tags saved correctly
  await test('T-5. POST /api/memories with tags — tags persisted', async () => {
    const r = await request(port, 'POST', '/api/memories', {
      title: 'New tagged', content: 'Created with tags.', tags: ['node', 'test']
    });
    assert.strictEqual(r.status, 201);
    assert(Array.isArray(r.body.tags), 'tags must be array');
    assert(r.body.tags.includes('node'), 'must include node tag');
    assert(r.body.tags.includes('test'), 'must include test tag');
  });

  // T-6: PUT /api/memories/:id with tags — updates tags
  await test('T-6. PUT /api/memories/:id — updates tags', async () => {
    const r = await request(port, 'PUT', `/api/memories/${m3.id}`, { tags: ['newlyadded'] });
    assert.strictEqual(r.status, 200);
    assert((r.body.tags||[]).includes('newlyadded'), 'must include new tag');
  });

  // T-7: tag filter returns empty array for unknown tag
  await test('T-7. GET /api/memories?tag=nonexistent — returns empty array', async () => {
    const r = await get(port, '/api/memories?tag=nonexistent-tag-xyz');
    const d = JSON.parse(r.body);
    assert.strictEqual(d.length, 0, 'must return empty for unknown tag');
  });

  // T-8: dashboard HTML has tag filter select
  await test('T-8. GET / — HTML has mtag select for tag filtering', async () => {
    const r = await get(port, '/');
    assert(r.body.includes('id="mtag"'), 'must include mtag select');
    assert(r.body.includes("g('mtag').value"), 'loadMem must read mtag');
  });

  // T-9: dashboard HTML has tags field in modal
  await test('T-9. GET / — HTML has tags input in add/edit modal', async () => {
    const r = await get(port, '/');
    assert(r.body.includes('id="nm-tg"'), 'must include nm-tg tags input');
    assert(r.body.includes('comma-separated'), 'must have tag hint text');
  });

  // T-10: dashboard HTML includes loadTagSelect and filterTag functions
  await test('T-10. GET / — HTML has loadTagSelect and filterTag functions', async () => {
    const r = await get(port, '/');
    assert(r.body.includes('loadTagSelect'), 'must include loadTagSelect');
    assert(r.body.includes('filterTag'), 'must include filterTag');
    assert(r.body.includes('/api/tags'), 'must call /api/tags endpoint');
  });

  // ── Cleanup ───────────────────────────────────────────────────────────────
  srv.close();
  closeDb();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  console.log(`\n${pass + fail} tests: ${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);

})();
