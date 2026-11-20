'use strict';
const assert = require('assert');
const path   = require('path');
const http   = require('http');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p48-${Date.now()}.db`);

function req(method, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: '127.0.0.1', port: 7749, path: pathname, method,
      headers: { 'Content-Type': 'application/json', 'X-Hive-Local': '1',
                 ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}) },
    };
    const r = http.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => { let b; try { b = JSON.parse(raw); } catch { b = raw; } resolve({ status: res.statusCode, body: b }); });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

async function addMem(title, overrides = {}) {
  const r = await req('POST', '/api/memories', {
    title, content: title, memory_type: 'semantic',
    importance: 5, confidence: 0.5,
    ...overrides,
  });
  return r.body;
}

async function run() {
  let passed = 0;
  const total = 10;
  async function test(name, fn) {
    try { await fn(); console.log(`  ✓ ${name}`); passed++; }
    catch (e) { console.log(`  ✗ ${name}: ${e.message}`); }
  }

  console.log('\nPhase 48 — Search Filters UI\n');

  const dom = `p48dom_${Date.now()}`;
  await addMem('P48 HighImp', { importance: 9, domain: dom });
  await addMem('P48 MidImp',  { importance: 6, domain: dom });
  await addMem('P48 LowImp',  { importance: 2, domain: dom });
  await addMem('P48 NoDom',   { importance: 7 });

  // 1. GET /api/domains returns array of strings
  await test('GET /api/domains returns array', async () => {
    const r = await req('GET', '/api/domains');
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.body), 'expected array');
  });

  // 2. seeded domain appears in /api/domains
  await test('/api/domains includes seeded domain', async () => {
    const r = await req('GET', '/api/domains');
    assert.ok(r.body.includes(dom), `domain ${dom} not found in ${JSON.stringify(r.body)}`);
  });

  // 3. domain filter returns only matching memories
  await test('domain filter returns only matching memories', async () => {
    const r = await req('GET', `/api/memories?domain=${dom}`);
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.length >= 3, `expected >=3, got ${r.body.length}`);
    for (const m of r.body) assert.strictEqual(m.domain, dom, `"${m.title}" has wrong domain`);
  });

  // 4. domain filter excludes memories without that domain
  await test('domain filter excludes memories without domain', async () => {
    const r = await req('GET', `/api/memories?domain=${dom}`);
    const noDom = r.body.find(m => m.title === 'P48 NoDom');
    assert.ok(!noDom, 'P48 NoDom should not appear in domain-filtered results');
  });

  // 5. min_importance=8 returns only high-importance memories
  await test('min_importance filter returns only matching memories', async () => {
    const r = await req('GET', '/api/memories?min_importance=8');
    assert.strictEqual(r.status, 200);
    for (const m of r.body) assert.ok(m.importance >= 8, `"${m.title}" has importance ${m.importance} < 8`);
  });

  // 6. P48 HighImp (importance=9) appears with min_importance=8
  await test('P48 HighImp appears with min_importance=8', async () => {
    const r = await req('GET', '/api/memories?min_importance=8');
    const found = r.body.find(m => m.title === 'P48 HighImp');
    assert.ok(found, 'P48 HighImp should appear with min_importance=8');
  });

  // 7. P48 LowImp (importance=2) excluded with min_importance=6
  await test('P48 LowImp excluded with min_importance=6', async () => {
    const r = await req('GET', '/api/memories?min_importance=6');
    const low = r.body.find(m => m.title === 'P48 LowImp');
    assert.ok(!low, 'P48 LowImp should be excluded with min_importance=6');
  });

  // 8. sort=importance returns pinned DESC then importance DESC
  await test('sort=importance returns in importance order', async () => {
    const r = await req('GET', `/api/memories?domain=${dom}&sort=importance&limit=10`);
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.length >= 3);
    // first unpinned result should have importance >= second
    const unpinned = r.body.filter(m => !m.pinned);
    if (unpinned.length >= 2) {
      assert.ok(unpinned[0].importance >= unpinned[1].importance,
        `expected ${unpinned[0].importance} >= ${unpinned[1].importance}`);
    }
  });

  // 9. sort=confidence returns in confidence order
  await test('sort=confidence returns in confidence order', async () => {
    await addMem('P48 HighConf', { confidence: 0.9 });
    await addMem('P48 LowConf',  { confidence: 0.1 });
    const r = await req('GET', '/api/memories?sort=confidence&limit=100');
    assert.strictEqual(r.status, 200);
    const unpinned = r.body.filter(m => !m.pinned);
    if (unpinned.length >= 2) {
      assert.ok(unpinned[0].confidence >= unpinned[1].confidence,
        `expected ${unpinned[0].confidence} >= ${unpinned[1].confidence}`);
    }
  });

  // 10. domain + min_importance combined filter
  await test('domain + min_importance combined filter works', async () => {
    const r = await req('GET', `/api/memories?domain=${dom}&min_importance=7`);
    assert.strictEqual(r.status, 200);
    for (const m of r.body) {
      assert.strictEqual(m.domain, dom);
      assert.ok(m.importance >= 7, `"${m.title}" has importance ${m.importance}`);
    }
    // P48 LowImp (imp=2, same domain) should be excluded
    assert.ok(!r.body.find(m => m.title === 'P48 LowImp'), 'P48 LowImp should be excluded');
    // P48 HighImp (imp=9) should be included
    assert.ok(r.body.find(m => m.title === 'P48 HighImp'), 'P48 HighImp should be included');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
