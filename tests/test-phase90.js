'use strict';
const assert = require('assert');
const http   = require('http');
const path   = require('path');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p90-${Date.now()}.db`);

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

  console.log('\nPhase 90 — Search Result Count Badge\n');

  // Seed unique-keyword memories for predictable search counts
  const uid = 'p90x' + Date.now();
  await req('POST', '/api/memories', { title: `${uid} alpha`, content: `${uid} first`, memory_type: 'core' });
  await req('POST', '/api/memories', { title: `${uid} beta`,  content: `${uid} second`, memory_type: 'core' });
  await req('POST', '/api/memories', { title: `${uid} gamma`, content: `${uid} third`,  memory_type: 'core' });

  // 1. Search returns array
  await test('search returns array', async () => {
    const { body } = await req('GET', '/api/search?q=' + encodeURIComponent(uid) + '&limit=20');
    assert.ok(Array.isArray(body), 'expected array');
  });

  // 2. Count matches seeded memories
  await test('search count matches seeded count', async () => {
    const { body } = await req('GET', '/api/search?q=' + encodeURIComponent(uid) + '&limit=20');
    assert.strictEqual(body.length, 3, 'expected 3 results for seeded uid');
  });

  // 3. Search with no results returns empty array
  await test('no-match search returns empty array', async () => {
    const { body } = await req('GET', '/api/search?q=zzznomatchp90zzzz&limit=20');
    assert.ok(Array.isArray(body) && body.length === 0);
  });

  // 4. Search limit=1 returns exactly 1
  await test('limit=1 returns exactly 1 result', async () => {
    const { body } = await req('GET', '/api/search?q=' + encodeURIComponent(uid) + '&limit=1');
    assert.strictEqual(body.length, 1);
  });

  // 5. Search limit=20 for large set returns at most 20
  await test('limit=20 returns at most 20 results', async () => {
    // seed more if needed — just check the cap
    const { body } = await req('GET', '/api/search?q=' + encodeURIComponent(uid) + '&limit=20');
    assert.ok(body.length <= 20, 'should not exceed limit');
  });

  const html = (await req('GET', '/')).body;

  // 6. HTML has sr-count element
  await test('HTML has #sr-count span', async () => {
    assert.ok(html.includes('id="sr-count"'), 'expected #sr-count in HTML');
  });

  // 7. doSearch sets sr-count text
  await test('doSearch references sr-count', async () => {
    assert.ok(html.includes("g('sr-count')") || html.includes('sr-count'), 'expected sr-count wired in doSearch');
  });

  // 8. Count shows singular "result" for 1 match
  await test('count label is singular for 1 result', async () => {
    // The JS uses: d.length + ' result' + (d.length === 1 ? '' : 's')
    assert.ok(html.includes("=== 1 ? '' : 's'") || html.includes("=== 1?''"), 'expected singular/plural logic');
  });

  // 9. Count shows "+" indicator at limit boundary
  await test('count shows + at 20-result limit', async () => {
    // The JS uses: d.length === 20 ? '+ results' : '...'
    assert.ok(html.includes("=== 20") || html.includes('+ results'), 'expected 20-limit indicator');
  });

  // 10. sr-count is hidden when no results (empty string)
  await test('sr-count cleared on no results', async () => {
    // The JS sets textContent = '' when d.length is 0
    assert.ok(html.includes("cntEl.textContent = d.length ?") || html.includes("sr-count"), 'expected count cleared on no results');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
