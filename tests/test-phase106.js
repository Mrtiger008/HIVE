'use strict';
const assert = require('assert');
const http   = require('http');
const path   = require('path');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p106-${Date.now()}.db`);

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

  console.log('\nPhase 106 — Domain Breakdown Stats\n');

  // Seed memories across domains
  await req('POST', '/api/memories', { title: 'EngA', content: 'engineering content a', memory_type: 'core',     domain: 'engineering', confidence: 0.8, importance: 8 });
  await req('POST', '/api/memories', { title: 'EngB', content: 'engineering content b', memory_type: 'core',     domain: 'engineering', confidence: 0.6, importance: 6 });
  await req('POST', '/api/memories', { title: 'SciA', content: 'science content a',     memory_type: 'semantic', domain: 'science',     confidence: 0.9, importance: 9 });
  await req('POST', '/api/memories', { title: 'NoDOM', content: 'no domain here',       memory_type: 'core' });

  // 1. endpoint returns 200
  await test('GET /api/stats/domain-breakdown returns 200', async () => {
    const { status } = await req('GET', '/api/stats/domain-breakdown');
    assert.strictEqual(status, 200);
  });

  // 2. returns array
  await test('response is an array', async () => {
    const { body } = await req('GET', '/api/stats/domain-breakdown');
    assert.ok(Array.isArray(body), 'expected array');
  });

  // 3. each item has domain, count, avg_conf, avg_importance
  await test('each item has required fields', async () => {
    const { body } = await req('GET', '/api/stats/domain-breakdown');
    assert.ok(body.length > 0, 'expected at least one domain');
    for (const r of body) {
      assert.ok('domain'         in r, 'expected domain field');
      assert.ok('count'          in r, 'expected count field');
      assert.ok('avg_conf'       in r, 'expected avg_conf field');
      assert.ok('avg_importance' in r, 'expected avg_importance field');
    }
  });

  // 4. engineering domain appears with count >= 2
  await test('engineering domain has count >= 2', async () => {
    const { body } = await req('GET', '/api/stats/domain-breakdown');
    const eng = body.find(r => r.domain === 'engineering');
    assert.ok(eng, 'engineering domain should appear');
    assert.ok(eng.count >= 2, `expected >= 2, got ${eng.count}`);
  });

  // 5. science domain appears with count >= 1
  await test('science domain has count >= 1', async () => {
    const { body } = await req('GET', '/api/stats/domain-breakdown');
    const sci = body.find(r => r.domain === 'science');
    assert.ok(sci, 'science domain should appear');
    assert.ok(sci.count >= 1, `expected >= 1, got ${sci.count}`);
  });

  // 6. memories without domain are excluded
  await test('memories without domain excluded from breakdown', async () => {
    const { body } = await req('GET', '/api/stats/domain-breakdown');
    assert.ok(!body.some(r => r.domain === null || r.domain === ''), 'null/empty domain should not appear');
  });

  // 7. avg_conf for engineering is between 0 and 1
  await test('engineering avg_conf is between 0 and 1', async () => {
    const { body } = await req('GET', '/api/stats/domain-breakdown');
    const eng = body.find(r => r.domain === 'engineering');
    assert.ok(eng && eng.avg_conf >= 0 && eng.avg_conf <= 1, `avg_conf ${eng?.avg_conf} should be in [0,1]`);
  });

  // 8. avg_importance for science is between 1 and 10
  await test('science avg_importance is between 1 and 10', async () => {
    const { body } = await req('GET', '/api/stats/domain-breakdown');
    const sci = body.find(r => r.domain === 'science');
    assert.ok(sci && sci.avg_importance >= 1 && sci.avg_importance <= 10, `avg_importance ${sci?.avg_importance} should be in [1,10]`);
  });

  // 9. sorted by count descending
  await test('results sorted by count descending', async () => {
    const { body } = await req('GET', '/api/stats/domain-breakdown');
    for (let i = 1; i < body.length; i++) {
      assert.ok(body[i-1].count >= body[i].count, `item ${i-1} count should be >= item ${i}`);
    }
  });

  const html = (await req('GET', '/')).body;

  // 10. HTML has ks-domain-breakdown element
  await test('HTML has ks-domain-breakdown element', async () => {
    assert.ok(html.includes('ks-domain-breakdown'), 'expected ks-domain-breakdown in HTML');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
