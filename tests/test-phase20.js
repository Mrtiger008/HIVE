'use strict';
// HIVE Phase 20 — Activity feed tests.
// Run: node tests/test-phase20.js

const assert = require('assert');
const path   = require('path');
const fs     = require('fs');
const http   = require('http');

const TEST_DB = path.join(__dirname, '..', 'database', 'hive-p20-test.db');
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
    const data = JSON.stringify(payload || {});
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

console.log('\nHIVE — Phase 20 activity feed tests\n');

const srv = createServer();
srv.listen(0);
const port = srv.address().port;

// Seed — create and update a memory to generate audit events
const m1 = memory.add({ title: 'Activity test memory', content: 'Created for activity feed testing.' });
memory.update(m1.id, { importance: 8 });

(async () => {

  // A-1: GET /api/activity returns array
  await test('A-1. GET /api/activity — returns array', async () => {
    const r = await get(port, '/api/activity');
    assert.strictEqual(r.status, 200);
    const d = JSON.parse(r.body);
    assert(Array.isArray(d), 'must return array');
  });

  // A-2: activity entries have required fields
  await test('A-2. GET /api/activity — entries have required fields', async () => {
    const r = await get(port, '/api/activity');
    const d = JSON.parse(r.body);
    assert(d.length > 0, 'must have entries after seeding');
    const e = d[0];
    assert('action' in e,      'must have action');
    assert('entity_type' in e, 'must have entity_type');
    assert('entity_id' in e,   'must have entity_id');
    assert('timestamp' in e,   'must have timestamp');
    assert('time_ago' in e,    'must have time_ago');
  });

  // A-3: CREATE event appears for the seeded memory
  await test('A-3. GET /api/activity — CREATE event present for seeded memory', async () => {
    const r = await get(port, '/api/activity');
    const d = JSON.parse(r.body);
    const ev = d.find(e => e.action === 'CREATE' && e.entity_id === m1.id);
    assert(ev, 'CREATE event must appear for seeded memory');
    assert.strictEqual(ev.entity_type, 'memory');
  });

  // A-4: UPDATE event appears after memory.update()
  await test('A-4. GET /api/activity — UPDATE event present after update', async () => {
    const r = await get(port, '/api/activity');
    const d = JSON.parse(r.body);
    const ev = d.find(e => e.action === 'UPDATE' && e.entity_id === m1.id);
    assert(ev, 'UPDATE event must appear');
  });

  // A-5: activity entry for memory event includes the memory title
  await test('A-5. GET /api/activity — memory events include title', async () => {
    const r = await get(port, '/api/activity');
    const d = JSON.parse(r.body);
    const ev = d.find(e => e.entity_id === m1.id && e.title);
    assert(ev, 'must find event with title');
    assert.strictEqual(ev.title, 'Activity test memory');
  });

  // A-6: time_ago is a human-readable string
  await test('A-6. GET /api/activity — time_ago is human-readable', async () => {
    const r = await get(port, '/api/activity');
    const d = JSON.parse(r.body);
    const e = d[0];
    assert(/\d+[smhd] ago/.test(e.time_ago), `time_ago "${e.time_ago}" must match pattern like "5s ago"`);
  });

  // A-7: most recent events appear first
  await test('A-7. GET /api/activity — ordered newest first', async () => {
    const r = await get(port, '/api/activity');
    const d = JSON.parse(r.body);
    for (let i = 1; i < d.length; i++) {
      assert(d[i-1].timestamp >= d[i].timestamp, 'must be sorted by timestamp descending');
    }
  });

  // A-8: limit param is respected
  await test('A-8. GET /api/activity?limit=1 — returns at most 1 entry', async () => {
    const r = await get(port, '/api/activity?limit=1');
    const d = JSON.parse(r.body);
    assert(d.length <= 1, 'limit=1 must return at most 1 entry');
  });

  // A-9: dashboard HTML has activity tab
  await test('A-9. GET / — HTML has activity tab and nav button', async () => {
    const r = await get(port, '/');
    assert(r.body.includes('id="activity"'), 'must include activity tab div');
    assert(r.body.includes("show('activity',this)"), 'must include Activity nav button');
    assert(r.body.includes('>Activity<'), 'button must be labelled Activity');
  });

  // A-10: dashboard HTML includes loadActivity function
  await test('A-10. GET / — HTML has loadActivity function', async () => {
    const r = await get(port, '/');
    assert(r.body.includes('loadActivity'), 'must include loadActivity function');
    assert(r.body.includes('/api/activity'), 'must call /api/activity endpoint');
  });

  // ── Cleanup ───────────────────────────────────────────────────────────────
  srv.close();
  closeDb();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  console.log(`\n${pass + fail} tests: ${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);

})();
