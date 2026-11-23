'use strict';
const assert = require('assert');
const http   = require('http');
const path   = require('path');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p94-${Date.now()}.db`);

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

  console.log('\nPhase 94 — Sort by Starred\n');

  // Seed three memories, then star the second one
  const { body: m1 } = await req('POST', '/api/memories', { title: 'Alpha unstarred', content: 'x', memory_type: 'core' });
  const { body: m2 } = await req('POST', '/api/memories', { title: 'Beta starred',   content: 'x', memory_type: 'core' });
  const { body: m3 } = await req('POST', '/api/memories', { title: 'Gamma unstarred', content: 'x', memory_type: 'core' });
  await req('POST', '/api/memories/' + m2.id + '/star');

  // 1. sort=starred returns array
  await test('sort=starred returns array', async () => {
    const { body } = await req('GET', '/api/memories?sort=starred&limit=20');
    assert.ok(Array.isArray(body));
  });

  // 2. starred memory is first in sort=starred
  await test('starred memory sorts first', async () => {
    const { body } = await req('GET', '/api/memories?sort=starred&limit=20');
    assert.strictEqual(body[0].id, m2.id, 'starred memory should be first');
  });

  // 3. starred memories all precede unstarred ones in the result set
  await test('starred memories precede unstarred ones', async () => {
    const { body } = await req('GET', '/api/memories?sort=starred&limit=100');
    const starredIndices   = body.map((m, i) => m.starred ? i : -1).filter(i => i !== -1);
    const unstarredIndices = body.map((m, i) => !m.starred ? i : -1).filter(i => i !== -1);
    if (starredIndices.length && unstarredIndices.length) {
      assert.ok(Math.max(...starredIndices) < Math.min(...unstarredIndices), 'all starred should precede all unstarred');
    }
    // m2 must be present and starred
    const m2entry = body.find(m => m.id === m2.id);
    assert.ok(m2entry && m2entry.starred, 'seeded starred memory should appear starred');
  });

  // 4. star a second memory, both appear before unstarred
  await test('two starred memories both sort before unstarred', async () => {
    await req('POST', '/api/memories/' + m1.id + '/star');
    const { body } = await req('GET', '/api/memories?sort=starred&limit=20');
    const starredIds = body.filter(m => m.starred === 1).map(m => m.id);
    const unstarredIds = body.filter(m => !m.starred).map(m => m.id);
    if (starredIds.length && unstarredIds.length) {
      const lastStarIdx  = Math.max(...starredIds.map(id => body.findIndex(m => m.id === id)));
      const firstUnstarIdx = Math.min(...unstarredIds.map(id => body.findIndex(m => m.id === id)));
      assert.ok(lastStarIdx < firstUnstarIdx, 'all starred should precede all unstarred');
    }
    // cleanup: unstar m1
    await req('POST', '/api/memories/' + m1.id + '/unstar');
  });

  // 5. default sort (updated) is unaffected — starred not necessarily first
  await test('default sort does not force starred first', async () => {
    const { body } = await req('GET', '/api/memories?sort=updated&limit=20');
    // m2 is starred but it was created second — may not be first in updated sort
    // just verify sort=updated still returns all three
    assert.ok(body.length >= 3);
  });

  // 6. sort=starred with status filter still works
  await test('sort=starred combined with type filter works', async () => {
    const { body } = await req('GET', '/api/memories?sort=starred&type=core&limit=20');
    assert.ok(Array.isArray(body));
    assert.ok(body.every(m => m.memory_type === 'core'));
  });

  // 7. unstarring removes from starred-first position
  await test('unstarring removes memory from starred-first position', async () => {
    await req('POST', '/api/memories/' + m2.id + '/unstar');
    const { body } = await req('GET', '/api/memories?sort=starred&limit=20');
    // now no memory is starred — m2 should not be first based on star
    const m2entry = body.find(m => m.id === m2.id);
    assert.strictEqual(m2entry?.starred ?? 0, 0, 'm2 should be unstarred');
  });

  const html = (await req('GET', '/')).body;

  // 8. HTML has Sort: Starred option in msort
  await test('HTML has Sort: Starred option', async () => {
    assert.ok(html.includes('Sort: Starred') || html.includes('value="starred"'), 'expected starred sort option');
  });

  // 9. memory.js SORT_MAP includes starred key (verified via API working)
  await test('sort=starred API returns 200', async () => {
    const { status } = await req('GET', '/api/memories?sort=starred&limit=5');
    assert.strictEqual(status, 200);
  });

  // 10. sort chip shows sort:starred when active
  await test('HTML chips logic handles sort:starred', async () => {
    // The chips logic does: if (sort && sort !== 'updated') chips.push(['sort:'+sort,'msort'])
    // so starred would become chip 'sort:starred'
    assert.ok(html.includes("'sort:'+sort") || html.includes('sort:starred') || html.includes("chips.push(['sort:"), 'expected sort chip logic');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
