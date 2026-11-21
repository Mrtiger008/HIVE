'use strict';
const assert = require('assert');
const http   = require('http');
const path   = require('path');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p72-${Date.now()}.db`);

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

// Helper: get sorted results filtered to only our test IDs
async function sortedSubset(ids) {
  const { body } = await req('GET', '/api/memories?sort=label&limit=10000');
  const set = new Set(ids);
  return body.filter(m => set.has(m.id));
}

async function run() {
  let passed = 0;
  const total = 10;
  async function test(name, fn) {
    try { await fn(); console.log(`  ✓ ${name}`); passed++; }
    catch (e) { console.log(`  ✗ ${name}: ${e.message}`); }
  }

  console.log('\nPhase 72 — Memory Sort by Label\n');

  // Seed memories with different labels and one unlabeled
  const { body: mRed }    = await req('POST', '/api/memories', { title: 'Red memory',    content: 'x', memory_type: 'core',   label: 'red'    });
  const { body: mBlue }   = await req('POST', '/api/memories', { title: 'Blue memory',   content: 'x', memory_type: 'domain', label: 'blue'   });
  const { body: mGreen }  = await req('POST', '/api/memories', { title: 'Green memory',  content: 'x', memory_type: 'core',   label: 'green'  });
  const { body: mYellow } = await req('POST', '/api/memories', { title: 'Yellow memory', content: 'x', memory_type: 'domain', label: 'yellow' });
  const { body: mNone }   = await req('POST', '/api/memories', { title: 'No label',      content: 'x', memory_type: 'core'                    });
  const allIds = [mRed.id, mBlue.id, mGreen.id, mYellow.id, mNone.id];

  const html = (await req('GET', '/')).body;

  // 1. dashboard msort select has Sort: Label option
  await test('msort select has Sort: Label option', async () => {
    assert.ok(html.includes('value="label"'), 'expected value="label" option in msort');
    assert.ok(html.includes('Sort: Label'), 'expected Sort: Label text');
  });

  // 2. GET /api/memories?sort=label returns 200
  await test('GET /api/memories?sort=label returns 200', async () => {
    const { status } = await req('GET', '/api/memories?sort=label&limit=100');
    assert.strictEqual(status, 200);
  });

  // 3. label sort includes our seeded memories
  await test('label sort result contains all 5 seeded memories', async () => {
    const sub = await sortedSubset(allIds);
    assert.strictEqual(sub.length, 5, `expected 5, got ${sub.length}`);
  });

  // 4. labeled memories appear before unlabeled (within test subset)
  await test('labeled memories appear before unlabeled when sort=label', async () => {
    const sub = await sortedSubset(allIds);
    const idx = id => sub.findIndex(m => m.id === id);
    const noneIdx = idx(mNone.id);
    assert.ok(idx(mRed.id)    < noneIdx, 'red should precede unlabeled');
    assert.ok(idx(mBlue.id)   < noneIdx, 'blue should precede unlabeled');
    assert.ok(idx(mGreen.id)  < noneIdx, 'green should precede unlabeled');
    assert.ok(idx(mYellow.id) < noneIdx, 'yellow should precede unlabeled');
  });

  // 5. red appears before yellow (custom order: red=0, yellow=1, green=2, blue=3)
  await test('red appears before yellow in label sort', async () => {
    const sub = await sortedSubset(allIds);
    const idx = id => sub.findIndex(m => m.id === id);
    assert.ok(idx(mRed.id) < idx(mYellow.id), 'red should precede yellow');
  });

  // 6. yellow appears before green
  await test('yellow appears before green in label sort', async () => {
    const sub = await sortedSubset(allIds);
    const idx = id => sub.findIndex(m => m.id === id);
    assert.ok(idx(mYellow.id) < idx(mGreen.id), 'yellow should precede green');
  });

  // 7. green appears before blue
  await test('green appears before blue in label sort', async () => {
    const sub = await sortedSubset(allIds);
    const idx = id => sub.findIndex(m => m.id === id);
    assert.ok(idx(mGreen.id) < idx(mBlue.id), 'green should precede blue');
  });

  // 8. label sort chip logic exists in loadMem
  await test('label sort chip logic exists in loadMem', async () => {
    assert.ok(html.includes("'sort:'+sort"), 'expected sort chip logic in loadMem');
  });

  // 9. label sort + label filter combined works
  await test('sort=label combined with label=red filter works', async () => {
    const { status, body } = await req('GET', '/api/memories?sort=label&label=red&limit=100');
    assert.strictEqual(status, 200);
    assert.ok(body.every(m => m.label === 'red'), 'all results should have label=red');
    assert.ok(body.some(m => m.id === mRed.id), 'mRed should be in results');
  });

  // 10. default sort=updated still works
  await test('default sort=updated still works after adding label sort', async () => {
    const { status, body } = await req('GET', '/api/memories?sort=updated&limit=100');
    assert.strictEqual(status, 200);
    assert.ok(Array.isArray(body) && body.length >= 5);
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
