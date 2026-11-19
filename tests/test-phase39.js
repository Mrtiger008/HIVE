'use strict';
const assert = require('assert');
const path   = require('path');
const http   = require('http');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p39-${Date.now()}.db`);

const memory   = require('../src/memory');
const timeline = require('../src/timeline');

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

async function run() {
  let passed = 0;
  const total = 10;

  async function test(name, fn) {
    try { await fn(); console.log(`  ✓ ${name}`); passed++; }
    catch (e) { console.log(`  ✗ ${name}: ${e.message}`); }
  }

  console.log('\nPhase 39 — Knowledge Timeline\n');

  // 1. get() returns expected shape
  await test('get() returns {periods, total, days, granularity}', async () => {
    const d = timeline.get();
    assert.ok(Array.isArray(d.periods));
    assert.ok(typeof d.total === 'number');
    assert.ok(typeof d.days === 'number');
    assert.ok(typeof d.granularity === 'string');
  });

  // 2. Default days=30
  await test('default days is 30', async () => {
    const d = timeline.get();
    assert.strictEqual(d.days, 30);
  });

  // 3. periods length covers the full range
  await test('periods spans full date range (days+1 entries for day granularity)', async () => {
    const d = timeline.get({ days: 7, granularity: 'day' });
    assert.ok(d.periods.length >= 7, `expected >=7 periods, got ${d.periods.length}`);
  });

  // 4. Each period has date, count, memories fields
  await test('each period has date, count, memories', async () => {
    const d = timeline.get({ days: 7 });
    for (const p of d.periods) {
      assert.ok(typeof p.date === 'string');
      assert.ok(typeof p.count === 'number');
      assert.ok(Array.isArray(p.memories));
    }
  });

  // 5. Recently added memory appears in timeline
  await test('recently added memory appears in timeline', async () => {
    memory.add({ title: 'Timeline test mem', content: 'C', memory_type: 'semantic' });
    const d = timeline.get({ days: 1 });
    assert.ok(d.total >= 1);
    const today = d.periods[d.periods.length - 1];
    assert.ok(today.count >= 1);
  });

  // 6. type filter works
  await test('memory_type filter returns only matching type', async () => {
    memory.add({ title: 'Core mem', content: 'C', memory_type: 'core' });
    memory.add({ title: 'Skill mem', content: 'C', memory_type: 'skill' });
    const d = timeline.get({ days: 1, memory_type: 'core' });
    for (const p of d.periods) {
      for (const m of p.memories) {
        assert.strictEqual(m.memory_type, 'core');
      }
    }
  });

  // 7. domain filter works
  await test('domain filter excludes other domains', async () => {
    memory.add({ title: 'Eng mem', content: 'C', memory_type: 'domain', domain: 'engineering' });
    memory.add({ title: 'Bio mem', content: 'C', memory_type: 'domain', domain: 'biology' });
    const d = timeline.get({ days: 1, domain: 'engineering' });
    for (const p of d.periods) {
      for (const m of p.memories) {
        assert.strictEqual(m.domain, 'engineering');
      }
    }
  });

  // 8. weekly granularity produces fewer periods than daily
  await test('weekly granularity produces fewer periods than daily for same window', async () => {
    const daily  = timeline.get({ days: 30, granularity: 'day' });
    const weekly = timeline.get({ days: 30, granularity: 'week' });
    assert.ok(weekly.periods.length < daily.periods.length,
      `weekly(${weekly.periods.length}) should be < daily(${daily.periods.length})`);
  });

  // 9. total equals sum of period counts
  await test('total equals sum of all period counts', async () => {
    const d = timeline.get({ days: 30 });
    const sum = d.periods.reduce((a, p) => a + p.count, 0);
    assert.strictEqual(sum, d.total);
  });

  // 10. API GET /api/timeline returns expected shape
  await test('GET /api/timeline returns {periods, total}', async () => {
    const r = await req('GET', '/api/timeline?days=7&granularity=day');
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.body.periods));
    assert.ok(typeof r.body.total === 'number');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
