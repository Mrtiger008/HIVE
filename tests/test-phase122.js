'use strict';
const assert = require('assert');
const http   = require('http');
const path   = require('path');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p122-${Date.now()}.db`);

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

  console.log('\nPhase 122 — Live Text Filter on Memory List\n');

  // Seed memories with distinct content
  const { body: m1 } = await req('POST', '/api/memories', { title: 'P122-Quantum Physics', content: 'Wave-particle duality explains quantum behavior', memory_type: 'core' });
  const { body: m2 } = await req('POST', '/api/memories', { title: 'P122-Cooking Recipe', content: 'Mix flour and eggs for the batter', memory_type: 'core' });
  const { body: m3 } = await req('POST', '/api/memories', { title: 'P122-Wave Theory', content: 'Electromagnetic waves propagate through space', memory_type: 'domain' });

  // 1. search param filters by title match
  await test('search=quantum matches title', async () => {
    const { body } = await req('GET', '/api/memories?search=quantum&limit=1000');
    assert.ok(Array.isArray(body));
    const ids = body.map(m => m.id);
    assert.ok(ids.includes(m1.id), 'quantum in title should match m1');
  });

  // 2. search param filters by content match
  await test('search=flour matches content', async () => {
    const { body } = await req('GET', '/api/memories?search=flour&limit=1000');
    assert.ok(Array.isArray(body));
    const ids = body.map(m => m.id);
    assert.ok(ids.includes(m2.id), 'flour in content should match m2');
  });

  // 3. search is case-insensitive
  await test('search is case-insensitive (WAVE matches wave)', async () => {
    const { body } = await req('GET', '/api/memories?search=WAVE&limit=1000');
    assert.ok(Array.isArray(body));
    const ids = body.map(m => m.id);
    assert.ok(ids.includes(m1.id) || ids.includes(m3.id), 'WAVE should match wave in content/title');
  });

  // 4. search term that matches nothing returns empty
  await test('search=xyzzy123uniquestring returns empty', async () => {
    const { body } = await req('GET', '/api/memories?search=xyzzy123uniquestring&limit=1000');
    assert.ok(Array.isArray(body));
    const ids = body.map(m => m.id);
    assert.ok(!ids.includes(m1.id) && !ids.includes(m2.id) && !ids.includes(m3.id), 'unique string should match nothing');
  });

  // 5. search can combine with type filter
  await test('search + type filter: search=wave&type=domain returns only m3', async () => {
    const { body } = await req('GET', '/api/memories?search=wave&type=domain&limit=1000');
    assert.ok(Array.isArray(body));
    const ids = body.map(m => m.id);
    assert.ok(ids.includes(m3.id), 'wave + domain type should include m3');
    assert.ok(!ids.includes(m2.id), 'cooking memory should not match wave');
  });

  // 6. search without param returns all memories (backward compat)
  await test('no search param returns all memories including seeds', async () => {
    const { body } = await req('GET', '/api/memories?limit=1000');
    assert.ok(Array.isArray(body));
    const ids = body.map(m => m.id);
    assert.ok(ids.includes(m1.id) && ids.includes(m2.id) && ids.includes(m3.id), 'no search should return all seeds');
  });

  // 7. search result count <= no-search result count
  await test('search result count <= full list count', async () => {
    const { body: all } = await req('GET', '/api/memories?limit=10000');
    const { body: filtered } = await req('GET', '/api/memories?search=wave&limit=10000');
    assert.ok(filtered.length <= all.length, 'filtered should be subset of full list');
  });

  // 8. search matches partial word
  await test('search=electromag matches electromagnetic', async () => {
    const { body } = await req('GET', '/api/memories?search=electromag&limit=1000');
    const ids = body.map(m => m.id);
    assert.ok(ids.includes(m3.id), 'partial word search should match m3');
  });

  const html = (await req('GET', '/')).body;

  // 9. HTML has msearch input
  await test('HTML has msearch text input', async () => {
    assert.ok(html.includes('msearch'), 'expected msearch input in HTML');
  });

  // 10. HTML uses &search= in _memUrl
  await test('HTML builds search query param in _memUrl', async () => {
    assert.ok(html.includes('&search=') || html.includes("+'&search='") || html.includes('"&search="'), 'expected &search= in _memUrl');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
