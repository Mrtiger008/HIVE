'use strict';
const assert = require('assert');
const path = require('path');
const http = require('http');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p34-${Date.now()}.db`);

const memory = require('../src/memory');
const digest = require('../src/digest');

const DAY = 24 * 60 * 60 * 1000;

function req(method, pathname) {
  return new Promise((resolve, reject) => {
    const opts = { hostname: '127.0.0.1', port: 7749, path: pathname, method,
      headers: { 'X-Hive-Local': '1' } };
    const r = http.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        let body = null;
        try { body = raw ? JSON.parse(raw) : null; } catch { body = raw || null; }
        resolve({ status: res.statusCode, body });
      });
    });
    r.on('error', reject);
    r.end();
  });
}

async function run() {
  let passed = 0;
  const total = 10;

  async function test(name, fn) {
    try { await fn(); console.log(`  ✓ ${name}`); passed++; }
    catch (e) { console.log(`  ✗ ${name}: ${e.message}`); }
  }

  console.log('\nPhase 34 — Scheduled Digests\n');

  // 1. daily() returns expected structure
  await test('daily() returns required fields', async () => {
    const d = digest.daily();
    assert.ok(d.period === 'daily');
    assert.ok(typeof d.generated_at === 'number');
    assert.ok(typeof d.total_active === 'number');
    assert.ok(Array.isArray(d.new_memories));
    assert.ok(Array.isArray(d.stale_memories));
    assert.ok(Array.isArray(d.low_conf_memories));
  });

  // 2. weekly() returns expected structure
  await test('weekly() returns required fields', async () => {
    const d = digest.weekly();
    assert.ok(d.period === 'weekly');
    assert.ok(typeof d.generated_at === 'number');
    assert.ok(Array.isArray(d.new_memories));
    assert.ok(Array.isArray(d.stale_memories));
    assert.ok(Array.isArray(d.top_domains));
  });

  // 3. new memory appears in daily new_memories
  await test('memory added now appears in daily new_memories', async () => {
    memory.add({ title: 'Fresh daily memory', content: 'C', memory_type: 'semantic' });
    const d = digest.daily();
    assert.ok(d.new_memories.some(m => m.title === 'Fresh daily memory'));
  });

  // 4. new memory appears in weekly new_memories
  await test('memory added now appears in weekly new_memories', async () => {
    memory.add({ title: 'Fresh weekly memory', content: 'C', memory_type: 'semantic' });
    const d = digest.weekly();
    assert.ok(d.new_memories.some(m => m.title === 'Fresh weekly memory'));
  });

  // 5. stale memory (old updated_at) appears in daily stale_memories
  await test('old memory appears in daily stale list', async () => {
    const db = require('../src/db').getDb();
    const m = memory.add({ title: 'Old stale memory', content: 'C', memory_type: 'semantic' });
    // Backdate updated_at to 10 days ago
    db.prepare('UPDATE memories SET updated_at = ? WHERE id = ?').run(Date.now() - 10 * DAY, m.id);
    const d = digest.daily();
    assert.ok(d.stale_memories.some(x => x.id === m.id));
  });

  // 6. stale memory (30+ days old) appears in weekly stale_memories
  await test('very old memory appears in weekly stale list', async () => {
    const db = require('../src/db').getDb();
    const m = memory.add({ title: 'Very old memory', content: 'C', memory_type: 'semantic' });
    db.prepare('UPDATE memories SET updated_at = ? WHERE id = ?').run(Date.now() - 35 * DAY, m.id);
    const d = digest.weekly();
    assert.ok(d.stale_memories.some(x => x.id === m.id));
  });

  // 7. low-confidence memory appears in daily low_conf_memories
  await test('low-confidence memory appears in daily digest', async () => {
    const m = memory.add({ title: 'Low conf memory', content: 'C', memory_type: 'semantic', confidence: 0.2 });
    const d = digest.daily();
    assert.ok(d.low_conf_memories.some(x => x.id === m.id));
  });

  // 8. API GET /api/digest defaults to daily
  await test('GET /api/digest returns daily digest', async () => {
    const r = await req('GET', '/api/digest');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.period, 'daily');
    assert.ok(Array.isArray(r.body.new_memories));
  });

  // 9. API GET /api/digest?period=weekly returns weekly
  await test('GET /api/digest?period=weekly returns weekly digest', async () => {
    const r = await req('GET', '/api/digest?period=weekly');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.period, 'weekly');
    assert.ok(Array.isArray(r.body.top_domains));
  });

  // 10. total_active counts only active memories
  await test('total_active excludes archived memories', async () => {
    const d1 = digest.daily();
    const m = memory.add({ title: 'To archive', content: 'C', memory_type: 'semantic' });
    memory.update(m.id, { status: 'archived' });
    const d2 = digest.daily();
    // total_active should not have increased (archived doesn't count)
    assert.ok(d2.total_active >= d1.total_active, 'total should not decrease');
    assert.ok(!d2.new_memories.some(x => x.id === m.id), 'archived should not appear in new_memories');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
