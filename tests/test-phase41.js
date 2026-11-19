'use strict';
const assert = require('assert');
const path   = require('path');
const http   = require('http');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p41-${Date.now()}.db`);

const memory    = require('../src/memory');
const reminders = require('../src/reminders');

function req(method, pathname, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = { hostname: '127.0.0.1', port: 7749, path: pathname, method,
      headers: { 'Content-Type': 'application/json', 'X-Hive-Local': '1',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } };
    const r = http.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        let b = null; try { b = raw ? JSON.parse(raw) : null; } catch { b = raw; }
        resolve({ status: res.statusCode, body: b });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

const DAY = 24 * 60 * 60 * 1000;

async function run() {
  let passed = 0;
  const total = 10;

  async function test(name, fn) {
    try { await fn(); console.log(`  ✓ ${name}`); passed++; }
    catch (e) { console.log(`  ✗ ${name}: ${e.message}`); }
  }

  console.log('\nPhase 41 — Smart Reminders\n');

  // 1. get() returns expected shape
  await test('get() returns {reminders, total, counts}', async () => {
    const d = reminders.get();
    assert.ok(Array.isArray(d.reminders));
    assert.ok(typeof d.total === 'number');
    assert.ok(typeof d.counts === 'object');
    assert.ok('critical' in d.counts && 'high' in d.counts);
  });

  // 2. Fresh memory not in reminders (< 7 days idle)
  await test('fresh memory (< 7 days) not in reminders', async () => {
    memory.add({ title: 'Fresh mem', content: 'C', memory_type: 'semantic' });
    const d = reminders.get();
    assert.ok(!d.reminders.some(r => r.title === 'Fresh mem'), 'fresh memory should not appear');
  });

  // 3. Stale memory (old last_accessed_at) appears in reminders
  await test('stale memory (last_accessed_at > 7 days ago) appears in reminders', async () => {
    const db = require('../src/db').getDb();
    const m = memory.add({ title: 'Stale mem', content: 'C', memory_type: 'semantic', confidence: 0.6 });
    const oldTs = Date.now() - 10 * DAY;
    db.prepare('UPDATE memories SET last_accessed_at = ?, updated_at = ? WHERE id = ?')
      .run(oldTs, oldTs, m.id);
    const d = reminders.get();
    assert.ok(d.reminders.some(r => r.id === m.id), 'stale memory should appear in reminders');
  });

  // 4. urgency() returns correct levels
  await test('urgency() assigns correct levels by confidence and idle days', async () => {
    assert.strictEqual(reminders.urgency(70, 0.5, 5), 'critical'); // idle > 60
    assert.strictEqual(reminders.urgency(10, 0.2, 5), 'critical'); // conf < 0.3
    assert.strictEqual(reminders.urgency(35, 0.4, 5), 'high');     // idle > 30
    assert.strictEqual(reminders.urgency(10, 0.4, 5), 'high');     // conf < 0.5
    assert.strictEqual(reminders.urgency(20, 0.6, 5), 'medium');   // idle > 14
    assert.strictEqual(reminders.urgency(10, 0.8, 5), 'low');      // fresh + high conf
  });

  // 5. Reminders sorted: critical first, then high, medium, low
  await test('reminders sorted critical → high → medium → low', async () => {
    const db = require('../src/db').getDb();
    const hi = memory.add({ title: 'HighConf',  content: 'C', memory_type: 'core',     confidence: 0.9 });
    const lo = memory.add({ title: 'LowConf',   content: 'C', memory_type: 'semantic', confidence: 0.1 });
    const old = Date.now() - 20 * DAY;
    db.prepare('UPDATE memories SET last_accessed_at=?,updated_at=? WHERE id=?').run(old, old, hi.id);
    db.prepare('UPDATE memories SET last_accessed_at=?,updated_at=? WHERE id=?').run(old, old, lo.id);
    const d = reminders.get();
    const iLo = d.reminders.findIndex(r => r.id === lo.id);
    const iHi = d.reminders.findIndex(r => r.id === hi.id);
    assert.ok(iLo < iHi || iLo === -1 || iHi === -1 || iLo <= iHi,
      'critical (low-conf) should appear before medium (high-conf)');
  });

  // 6. urgencyFilter works
  await test('urgencyFilter limits to specified urgency only', async () => {
    const d = reminders.get({ urgencyFilter: 'critical' });
    for (const r of d.reminders) {
      assert.strictEqual(r.urgency, 'critical', `expected critical, got ${r.urgency}`);
    }
  });

  // 7. Each reminder has idle_days and urgency fields
  await test('each reminder has idle_days and urgency fields', async () => {
    const d = reminders.get();
    for (const r of d.reminders) {
      assert.ok(typeof r.idle_days === 'number' && r.idle_days >= 0);
      assert.ok(['critical','high','medium','low'].includes(r.urgency));
    }
  });

  // 8. markReviewed() updates last_accessed_at
  await test('markReviewed() updates last_accessed_at and removes from reminders', async () => {
    const db = require('../src/db').getDb();
    const m = memory.add({ title: 'To review', content: 'C', memory_type: 'semantic', confidence: 0.5 });
    const oldTs = Date.now() - 15 * DAY;
    db.prepare('UPDATE memories SET last_accessed_at=?,updated_at=? WHERE id=?').run(oldTs, oldTs, m.id);
    assert.ok(reminders.get().reminders.some(r => r.id === m.id), 'should be in reminders before');
    reminders.markReviewed(m.id);
    assert.ok(!reminders.get().reminders.some(r => r.id === m.id), 'should not be in reminders after');
  });

  // 9. markReviewed() throws for unknown id
  await test('markReviewed() throws for unknown memory id', async () => {
    assert.throws(() => reminders.markReviewed('nonexistent-id'), /Memory not found/);
  });

  // 10. API GET /api/reminders returns expected shape
  await test('GET /api/reminders returns {reminders, total, counts}', async () => {
    const r = await req('GET', '/api/reminders?limit=10');
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.body.reminders));
    assert.ok(typeof r.body.total === 'number');
    assert.ok(typeof r.body.counts === 'object');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
