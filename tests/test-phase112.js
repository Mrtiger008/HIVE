'use strict';
const assert = require('assert');
const http   = require('http');
const path   = require('path');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p112-${Date.now()}.db`);

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

  console.log('\nPhase 112 — Activity by Weekday\n');

  // Seed a few memories so the endpoint has data
  await req('POST', '/api/memories', { title: 'WD1', content: 'weekday one content', memory_type: 'core' });
  await req('POST', '/api/memories', { title: 'WD2', content: 'weekday two content', memory_type: 'core' });

  // 1. endpoint returns 200
  await test('GET /api/stats/weekday-dist returns 200', async () => {
    const { status } = await req('GET', '/api/stats/weekday-dist');
    assert.strictEqual(status, 200);
  });

  // 2. returns array
  await test('response is an array', async () => {
    const { body } = await req('GET', '/api/stats/weekday-dist');
    assert.ok(Array.isArray(body), 'expected array');
  });

  // 3. always returns exactly 7 entries (Sun–Sat)
  await test('returns exactly 7 entries', async () => {
    const { body } = await req('GET', '/api/stats/weekday-dist');
    assert.strictEqual(body.length, 7, `expected 7, got ${body.length}`);
  });

  // 4. each entry has label and count
  await test('each entry has label and count', async () => {
    const { body } = await req('GET', '/api/stats/weekday-dist');
    for (const r of body) {
      assert.ok('label' in r, 'expected label field');
      assert.ok('count' in r && typeof r.count === 'number', 'expected numeric count');
    }
  });

  // 5. labels are the 7 weekday abbreviations in order
  await test('labels are Sun Mon Tue Wed Thu Fri Sat in order', async () => {
    const { body } = await req('GET', '/api/stats/weekday-dist');
    const expected = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    assert.deepStrictEqual(body.map(r => r.label), expected);
  });

  // 6. all counts are non-negative
  await test('all counts are non-negative', async () => {
    const { body } = await req('GET', '/api/stats/weekday-dist');
    for (const r of body) {
      assert.ok(r.count >= 0, `${r.label} has negative count`);
    }
  });

  // 7. total count matches number of active memories seeded
  await test('sum of counts >= 2 (matches seeded memories)', async () => {
    const { body } = await req('GET', '/api/stats/weekday-dist');
    const total = body.reduce((s, r) => s + r.count, 0);
    assert.ok(total >= 2, `expected sum >= 2, got ${total}`);
  });

  // 8. zero-count days present (not filtered out)
  await test('zero-count days included (all 7 always returned)', async () => {
    const { body } = await req('GET', '/api/stats/weekday-dist');
    // at least one day must have 0 (can't create memories on all 7 unique days in one test run)
    const hasZero = body.some(r => r.count === 0);
    assert.ok(hasZero, 'expected at least one day with 0 count');
  });

  const html = (await req('GET', '/')).body;

  // 9. HTML has ks-weekday-dist element
  await test('HTML has ks-weekday-dist element', async () => {
    assert.ok(html.includes('ks-weekday-dist'), 'expected ks-weekday-dist in HTML');
  });

  // 10. HTML fetches /api/stats/weekday-dist
  await test('HTML fetches /api/stats/weekday-dist', async () => {
    assert.ok(html.includes('/api/stats/weekday-dist'), 'expected weekday-dist endpoint in HTML');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
