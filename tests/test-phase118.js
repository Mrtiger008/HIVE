'use strict';
const assert = require('assert');
const http   = require('http');
const path   = require('path');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p118-${Date.now()}.db`);

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

  console.log('\nPhase 118 — Sort Direction Toggle\n');

  // Seed 3 memories with distinct importances
  const { body: m1 } = await req('POST', '/api/memories', { title: 'P118-Alpha', content: 'first memory p118', memory_type: 'core', importance: 3 });
  await new Promise(r => setTimeout(r, 15));
  const { body: m2 } = await req('POST', '/api/memories', { title: 'P118-Beta', content: 'second memory p118', memory_type: 'core', importance: 9 });
  await new Promise(r => setTimeout(r, 15));
  const { body: m3 } = await req('POST', '/api/memories', { title: 'P118-Gamma', content: 'third memory p118', memory_type: 'core', importance: 5 });

  // 1. API accepts sort_dir param without error
  await test('GET /api/memories?sort_dir=asc returns 200', async () => {
    const { status } = await req('GET', '/api/memories?sort_dir=asc&limit=5');
    assert.strictEqual(status, 200);
  });

  // 2. sort_dir=asc with created: our 3 memories are newest → they appear near END of ASC result
  await test('sort_dir=asc: our 3 seeds all present in full result', async () => {
    const { body } = await req('GET', '/api/memories?sort=created&sort_dir=asc&limit=10000');
    assert.ok(Array.isArray(body));
    const ids = body.map(m => m.id);
    assert.ok(ids.includes(m1.id), 'm1 should be in results');
    assert.ok(ids.includes(m2.id), 'm2 should be in results');
    assert.ok(ids.includes(m3.id), 'm3 should be in results');
  });

  // 3. sort_dir=asc for created: m1 appears before m3 (m1 was created before m3)
  await test('sort_dir=asc: m1 (older) before m3 (newer) among our seeds', async () => {
    const { body } = await req('GET', '/api/memories?sort=created&sort_dir=asc&limit=10000');
    const ids = body.map(m => m.id);
    assert.ok(ids.indexOf(m1.id) < ids.indexOf(m3.id), 'in asc order, m1 (created first) should precede m3');
  });

  // 4. default sort (no sort_dir): m3 appears before m1 (newest first = desc)
  await test('default sort (desc): m3 (newest) before m1 (oldest) among seeds', async () => {
    const { body } = await req('GET', '/api/memories?sort=created&limit=10000');
    const ids = body.map(m => m.id);
    assert.ok(ids.indexOf(m3.id) < ids.indexOf(m1.id), 'in desc order, m3 (created last) should precede m1');
  });

  // 5. asc and desc ordering are opposites for created sort (first asc = last desc)
  await test('asc order is inverse of desc for created sort among our seeds', async () => {
    const { body: asc }  = await req('GET', '/api/memories?sort=created&sort_dir=asc&limit=10000');
    const { body: desc } = await req('GET', '/api/memories?sort=created&sort_dir=desc&limit=10000');
    const ascIds  = asc.map(m => m.id).filter(id => [m1.id,m2.id,m3.id].includes(id));
    const descIds = desc.map(m => m.id).filter(id => [m1.id,m2.id,m3.id].includes(id));
    assert.deepStrictEqual(ascIds, [...descIds].reverse(), 'asc seed order should be exact reverse of desc');
  });

  // 6. importance asc: m1 (imp=3) before m2 (imp=9)
  await test('sort=importance&sort_dir=asc: lowest importance first', async () => {
    const { body } = await req('GET', '/api/memories?sort=importance&sort_dir=asc&limit=10000');
    const ids = body.map(m => m.id);
    assert.ok(ids.indexOf(m1.id) < ids.indexOf(m2.id), 'importance=3 (m1) should come before importance=9 (m2) in asc');
  });

  // 7. importance desc: m2 (imp=9) before m1 (imp=3)
  await test('sort=importance&sort_dir=desc: highest importance first', async () => {
    const { body } = await req('GET', '/api/memories?sort=importance&sort_dir=desc&limit=10000');
    const ids = body.map(m => m.id);
    assert.ok(ids.indexOf(m2.id) < ids.indexOf(m1.id), 'importance=9 (m2) should come before importance=3 (m1) in desc');
  });

  // 8. sort_dir=desc matches no-sort_dir (explicit desc === implicit desc)
  await test('sort_dir=desc matches default (no sort_dir param)', async () => {
    const { body: def }  = await req('GET', '/api/memories?sort=created&limit=100');
    const { body: desc } = await req('GET', '/api/memories?sort=created&sort_dir=desc&limit=100');
    assert.ok(Array.isArray(def) && Array.isArray(desc));
    assert.strictEqual(def.map(m=>m.id).join(','), desc.map(m=>m.id).join(','), 'explicit desc must equal implicit desc');
  });

  const html = (await req('GET', '/')).body;

  // 9. HTML has msort-dir button
  await test('HTML has msort-dir button', async () => {
    assert.ok(html.includes('msort-dir'), 'expected msort-dir button id in HTML');
  });

  // 10. HTML has toggleSortDir function
  await test('HTML has toggleSortDir function', async () => {
    assert.ok(html.includes('toggleSortDir'), 'expected toggleSortDir function in HTML');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
