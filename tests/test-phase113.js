'use strict';
const assert = require('assert');
const http   = require('http');
const path   = require('path');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p113-${Date.now()}.db`);

function req(method, pathname, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = { hostname: '127.0.0.1', port: 7749, path: pathname, method,
                   headers: { 'X-Hive-Local': '1', ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) } };
    const r = http.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => { let b; try { b = JSON.parse(raw); } catch { b = raw; } resolve({ status: res.statusCode, body: b }); });
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

  console.log('\nPhase 113 — Hourly Activity Heatmap\n');

  // Seed memories so endpoint has data
  await req('POST', '/api/memories', { title: 'HR1', content: 'hour one content', memory_type: 'core' });
  await req('POST', '/api/memories', { title: 'HR2', content: 'hour two content', memory_type: 'core' });

  // 1. endpoint returns 200
  await test('GET /api/stats/hour-dist returns 200', async () => {
    const { status } = await req('GET', '/api/stats/hour-dist');
    assert.strictEqual(status, 200);
  });

  // 2. returns array
  await test('response is an array', async () => {
    const { body } = await req('GET', '/api/stats/hour-dist');
    assert.ok(Array.isArray(body), 'expected array');
  });

  // 3. always returns exactly 24 entries
  await test('returns exactly 24 entries', async () => {
    const { body } = await req('GET', '/api/stats/hour-dist');
    assert.strictEqual(body.length, 24, `expected 24, got ${body.length}`);
  });

  // 4. each entry has hour and count
  await test('each entry has hour and count fields', async () => {
    const { body } = await req('GET', '/api/stats/hour-dist');
    for (const r of body) {
      assert.ok('hour' in r, 'expected hour field');
      assert.ok('count' in r && typeof r.count === 'number', 'expected numeric count');
    }
  });

  // 5. hours run 0–23 in order
  await test('hours are 0–23 in ascending order', async () => {
    const { body } = await req('GET', '/api/stats/hour-dist');
    const hours = body.map(r => r.hour);
    assert.deepStrictEqual(hours, Array.from({length:24}, (_, i) => i));
  });

  // 6. all counts are non-negative
  await test('all counts are non-negative', async () => {
    const { body } = await req('GET', '/api/stats/hour-dist');
    for (const r of body) {
      assert.ok(r.count >= 0, `hour ${r.hour} has negative count`);
    }
  });

  // 7. sum of counts >= 2 (matches seeded memories)
  await test('sum of counts >= 2', async () => {
    const { body } = await req('GET', '/api/stats/hour-dist');
    const sum = body.reduce((s, r) => s + r.count, 0);
    assert.ok(sum >= 2, `expected sum >= 2, got ${sum}`);
  });

  // 8. zero-count hours are present (not filtered out)
  await test('zero-count hours included', async () => {
    const { body } = await req('GET', '/api/stats/hour-dist');
    const hasZero = body.some(r => r.count === 0);
    assert.ok(hasZero, 'expected at least one hour with 0 count');
  });

  const html = (await req('GET', '/')).body;

  // 9. HTML has ks-hour-dist element
  await test('HTML has ks-hour-dist element', async () => {
    assert.ok(html.includes('ks-hour-dist'), 'expected ks-hour-dist in HTML');
  });

  // 10. HTML fetches /api/stats/hour-dist
  await test('HTML fetches /api/stats/hour-dist', async () => {
    assert.ok(html.includes('/api/stats/hour-dist'), 'expected hour-dist endpoint in HTML');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
