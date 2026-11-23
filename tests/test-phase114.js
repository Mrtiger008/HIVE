'use strict';
const assert = require('assert');
const http   = require('http');
const path   = require('path');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p114-${Date.now()}.db`);

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

  console.log('\nPhase 114 — Monthly Activity Chart\n');

  // Seed memories so endpoint has data
  await req('POST', '/api/memories', { title: 'MO1', content: 'month one content', memory_type: 'core' });
  await req('POST', '/api/memories', { title: 'MO2', content: 'month two content', memory_type: 'core' });

  // 1. endpoint returns 200
  await test('GET /api/stats/month-dist returns 200', async () => {
    const { status } = await req('GET', '/api/stats/month-dist');
    assert.strictEqual(status, 200);
  });

  // 2. returns array
  await test('response is an array', async () => {
    const { body } = await req('GET', '/api/stats/month-dist');
    assert.ok(Array.isArray(body), 'expected array');
  });

  // 3. always returns exactly 12 entries
  await test('returns exactly 12 entries', async () => {
    const { body } = await req('GET', '/api/stats/month-dist');
    assert.strictEqual(body.length, 12, `expected 12, got ${body.length}`);
  });

  // 4. each entry has month, label and count
  await test('each entry has month, label and count', async () => {
    const { body } = await req('GET', '/api/stats/month-dist');
    for (const r of body) {
      assert.ok('month' in r, 'expected month field');
      assert.ok('label' in r && typeof r.label === 'string', 'expected string label');
      assert.ok('count' in r && typeof r.count === 'number', 'expected numeric count');
    }
  });

  // 5. months are in ascending order (YYYY-MM strings)
  await test('months are in ascending order', async () => {
    const { body } = await req('GET', '/api/stats/month-dist');
    for (let i = 1; i < body.length; i++) {
      assert.ok(body[i].month > body[i-1].month,
        `month ${body[i].month} not after ${body[i-1].month}`);
    }
  });

  // 6. last entry is current month
  await test('last entry is current month', async () => {
    const { body } = await req('GET', '/api/stats/month-dist');
    const now = new Date();
    const curMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    assert.strictEqual(body[body.length - 1].month, curMonth);
  });

  // 7. all counts are non-negative
  await test('all counts are non-negative', async () => {
    const { body } = await req('GET', '/api/stats/month-dist');
    for (const r of body) {
      assert.ok(r.count >= 0, `month ${r.month} has negative count`);
    }
  });

  // 8. current month count >= 2 (seeded this run)
  await test('current month count >= 2', async () => {
    const { body } = await req('GET', '/api/stats/month-dist');
    const last = body[body.length - 1];
    assert.ok(last.count >= 2, `expected current month >= 2, got ${last.count}`);
  });

  const html = (await req('GET', '/')).body;

  // 9. HTML has ks-month-dist element
  await test('HTML has ks-month-dist element', async () => {
    assert.ok(html.includes('ks-month-dist'), 'expected ks-month-dist in HTML');
  });

  // 10. HTML fetches /api/stats/month-dist
  await test('HTML fetches /api/stats/month-dist', async () => {
    assert.ok(html.includes('/api/stats/month-dist'), 'expected month-dist endpoint in HTML');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
