'use strict';
// HIVE Phase 16 — Review digest tests.
// Run: node tests/test-phase16.js

const assert = require('assert');
const path   = require('path');
const fs     = require('fs');
const http   = require('http');

const TEST_DB = path.join(__dirname, '..', 'database', 'hive-p16-test.db');
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

function post(port, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port, path: urlPath, method: 'POST',
      headers: { 'Content-Length': 0 },
    }, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

console.log('\nHIVE — Phase 16 review digest tests\n');

const srv = createServer();
srv.listen(0);
const port = srv.address().port;

// Seed memories
const m1 = memory.add({ title: 'Fresh memory', content: 'Recently accessed.', importance: 7 });
const m2 = memory.add({ title: 'Stale memory', content: 'Not accessed in a long time.', importance: 5 });
// Age m2 by setting last_accessed_at to 60 days ago
const sixtyDaysAgo = Date.now() - 60 * 86400000;
getDb().prepare('UPDATE memories SET last_accessed_at=?, created_at=? WHERE id=?').run(sixtyDaysAgo, sixtyDaysAgo, m2.id);

(async () => {

  // R-1: GET /api/review returns array
  await test('R-1. GET /api/review — returns array', async () => {
    const r = await get(port, '/api/review');
    assert.strictEqual(r.status, 200);
    const d = JSON.parse(r.body);
    assert(Array.isArray(d), 'must return array');
  });

  // R-2: results include days_idle field
  await test('R-2. GET /api/review — results have days_idle', async () => {
    const r = await get(port, '/api/review');
    const d = JSON.parse(r.body);
    assert(d.length > 0);
    assert('days_idle' in d[0], 'must include days_idle');
  });

  // R-3: results include urgency field
  await test('R-3. GET /api/review — results have urgency field', async () => {
    const r = await get(port, '/api/review');
    const d = JSON.parse(r.body);
    assert('urgency' in d[0], 'must include urgency');
    assert(['critical','warning','ok'].includes(d[0].urgency), 'urgency must be critical/warning/ok');
  });

  // R-4: stale memory classified as warning (60d idle)
  await test('R-4. GET /api/review — 60d idle memory is warning urgency', async () => {
    const r = await get(port, '/api/review');
    const d = JSON.parse(r.body);
    const stale = d.find(m => m.id === m2.id);
    assert(stale, 'stale memory must appear in review');
    assert.strictEqual(stale.urgency, 'warning', '60d idle = warning');
    assert(stale.days_idle >= 59 && stale.days_idle <= 61, `days_idle should be ~60, got ${stale.days_idle}`);
  });

  // R-5: stalest memories appear first (sorted by decay score ascending)
  await test('R-5. GET /api/review — stalest memories come first', async () => {
    const r = await get(port, '/api/review');
    const d = JSON.parse(r.body);
    assert(d.length >= 2, 'need at least 2 memories');
    // The 60d-idle memory must have more days_idle than the fresh one
    const staleIdx = d.findIndex(m => m.id === m2.id);
    const freshIdx = d.findIndex(m => m.id === m1.id);
    assert(staleIdx < freshIdx, 'stale memory must come before fresh memory');
  });

  // R-6: limit param is respected
  await test('R-6. GET /api/review?limit=1 — returns at most 1 result', async () => {
    const r = await get(port, '/api/review?limit=1');
    const d = JSON.parse(r.body);
    assert(d.length <= 1, 'limit=1 must return at most 1 result');
  });

  // R-7: POST /api/memories/:id/reinforce — returns ok
  await test('R-7. POST /api/memories/:id/reinforce — returns {ok:true}', async () => {
    const r = await post(port, `/api/memories/${m1.id}/reinforce`);
    assert.strictEqual(r.status, 200);
    const d = JSON.parse(r.body);
    assert.strictEqual(d.ok, true);
  });

  // R-8: reinforce increases importance
  await test('R-8. POST /api/memories/:id/reinforce — importance increases', async () => {
    const before = memory.get(m1.id).importance;
    await post(port, `/api/memories/${m1.id}/reinforce`);
    const after = memory.get(m1.id).importance;
    assert(after >= before, 'importance must not decrease after reinforce');
  });

  // R-9: dashboard HTML contains review tab
  await test('R-9. GET / — HTML has review tab', async () => {
    const r = await get(port, '/');
    assert(r.body.includes('id="review"'), 'must include review tab div');
    assert(r.body.includes("show('review',this)"), 'must include Review nav button');
  });

  // R-10: dashboard HTML includes loadReview and reinforceMem functions
  await test('R-10. GET / — HTML has loadReview and reinforceMem functions', async () => {
    const r = await get(port, '/');
    assert(r.body.includes('loadReview'), 'must include loadReview function');
    assert(r.body.includes('reinforceMem'), 'must include reinforceMem function');
    assert(r.body.includes('/api/review'), 'must call /api/review endpoint');
  });

  // ── Cleanup ───────────────────────────────────────────────────────────────
  srv.close();
  closeDb();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  console.log(`\n${pass + fail} tests: ${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);

})();
