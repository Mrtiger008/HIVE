'use strict';
const assert = require('assert');
const http   = require('http');

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

  console.log('\nPhase 125 — Sort by Title\n');

  // Seed three memories with known alphabetical order: Zappa, Alpha, Mango
  const { body: mZ } = await req('POST', '/api/memories', { title: 'P125-Zappa', content: 'z content', memory_type: 'core', domain: 'p125' });
  const { body: mA } = await req('POST', '/api/memories', { title: 'P125-Alpha', content: 'a content', memory_type: 'core', domain: 'p125' });
  const { body: mM } = await req('POST', '/api/memories', { title: 'P125-Mango', content: 'm content', memory_type: 'core', domain: 'p125' });

  // 1. sort=title returns 200
  await test('GET /api/memories?sort=title returns 200', async () => {
    const { status } = await req('GET', '/api/memories?sort=title&limit=10');
    assert.strictEqual(status, 200);
  });

  // 2. sort=title returns array
  await test('sort=title response is an array', async () => {
    const { body } = await req('GET', '/api/memories?sort=title&limit=10');
    assert.ok(Array.isArray(body));
  });

  // 3. Alpha comes before Mango in title-sorted results (domain-scoped)
  await test('Alpha before Mango in title-sorted results', async () => {
    const { body } = await req('GET', '/api/memories?sort=title&domain=p125&limit=1000');
    const ids = body.map(m => m.id);
    const iA = ids.indexOf(mA.id), iM = ids.indexOf(mM.id);
    assert.ok(iA < iM, `expected Alpha (pos ${iA}) before Mango (pos ${iM})`);
  });

  // 4. Mango comes before Zappa in title-sorted results (domain-scoped)
  await test('Mango before Zappa in title-sorted results', async () => {
    const { body } = await req('GET', '/api/memories?sort=title&domain=p125&limit=1000');
    const ids = body.map(m => m.id);
    const iM = ids.indexOf(mM.id), iZ = ids.indexOf(mZ.id);
    assert.ok(iM < iZ, `expected Mango (pos ${iM}) before Zappa (pos ${iZ})`);
  });

  // 5. Alpha comes before Zappa (full A-Z ordering, domain-scoped)
  await test('Alpha before Zappa in title-sorted results', async () => {
    const { body } = await req('GET', '/api/memories?sort=title&domain=p125&limit=1000');
    const ids = body.map(m => m.id);
    const iA = ids.indexOf(mA.id), iZ = ids.indexOf(mZ.id);
    assert.ok(iA < iZ, `expected Alpha (pos ${iA}) before Zappa (pos ${iZ})`);
  });

  // 6. Title sort is case-insensitive — seed a lowercase 'p125-aaa' and confirm it sorts before 'P125-Zappa'
  const { body: mLower } = await req('POST', '/api/memories', { title: 'p125-aaa', content: 'lowercase', memory_type: 'core', domain: 'p125' });
  await test('title sort is case-insensitive (lowercase before uppercase Z)', async () => {
    const { body } = await req('GET', '/api/memories?sort=title&domain=p125&limit=1000');
    const ids = body.map(m => m.id);
    const iLow = ids.indexOf(mLower.id), iZ = ids.indexOf(mZ.id);
    assert.ok(iLow < iZ, `expected lowercase (pos ${iLow}) before Zappa (pos ${iZ})`);
  });

  // 7. sort=title with limit respects limit
  await test('sort=title with limit=2 returns exactly 2 results', async () => {
    const { body } = await req('GET', '/api/memories?sort=title&limit=2');
    assert.strictEqual(body.length, 2);
  });

  // 8. sort=title within controlled domain is fully alphabetical (no pinned interference)
  await test('sort=title within domain=p125 is fully alphabetical', async () => {
    const { body } = await req('GET', '/api/memories?sort=title&domain=p125&limit=1000');
    assert.ok(Array.isArray(body) && body.length > 0);
    for (let i = 1; i < body.length; i++) {
      assert.ok(body[i-1].title.toLowerCase() <= body[i].title.toLowerCase(),
        `title order broken: "${body[i-1].title}" > "${body[i].title}"`);
    }
  });

  const html = (await req('GET', '/')).body;

  // 9. HTML sort select has title option
  await test('HTML sort select includes title option', async () => {
    assert.ok(html.includes('value="title"') && html.includes('Sort: Title'), 'expected Sort: Title option in sort select');
  });

  // 10. sort:title chip would appear (chip logic includes non-updated sort values)
  await test('HTML chip logic handles sort:title filter chip', async () => {
    // The loadMem chip code pushes ['sort:'+sort,'msort'] when sort !== 'updated'
    assert.ok(html.includes("'sort:'+sort") || html.includes('"sort:"+sort'), 'expected sort chip logic in loadMem');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
