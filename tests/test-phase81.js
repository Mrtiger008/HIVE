'use strict';
const assert = require('assert');
const http   = require('http');
const path   = require('path');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p81-${Date.now()}.db`);

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

  console.log('\nPhase 81 — Note Search\n');

  // Seed memories
  const { body: m1 } = await req('POST', '/api/memories', { title: 'Alpha topic', content: 'general content', memory_type: 'core', note: 'xyzuniquenote' });
  const { body: m2 } = await req('POST', '/api/memories', { title: 'Beta topic', content: 'xyzuniquenote appears here', memory_type: 'core' });
  const { body: m3 } = await req('POST', '/api/memories', { title: 'Gamma topic', content: 'nothing special', memory_type: 'core', note: 'completely different' });
  const { body: m4 } = await req('POST', '/api/memories', { title: 'Delta xyzuniquenote', content: 'nothing', memory_type: 'core' });

  // 1. Search returns memory whose note matches (note-only match)
  await test('search finds memory matched by note', async () => {
    const { body } = await req('GET', '/api/search?q=xyzuniquenote');
    const ids = body.map(m => m.id);
    assert.ok(ids.includes(m1.id), 'expected m1 (note match) in results');
  });

  // 2. Search also returns memory matched by content (no regression)
  await test('search still finds memory matched by content', async () => {
    const { body } = await req('GET', '/api/search?q=xyzuniquenote');
    const ids = body.map(m => m.id);
    assert.ok(ids.includes(m2.id), 'expected m2 (content match) in results');
  });

  // 3. Search returns memory matched by title (no regression)
  await test('search still finds memory matched by title', async () => {
    const { body } = await req('GET', '/api/search?q=xyzuniquenote');
    const ids = body.map(m => m.id);
    assert.ok(ids.includes(m4.id), 'expected m4 (title match) in results');
  });

  // 4. No duplicate: m1 appears exactly once even if note and content both match (seed doesn't overlap, but guard)
  await test('note-matched memory appears exactly once', async () => {
    const { body } = await req('GET', '/api/search?q=xyzuniquenote');
    const count = body.filter(m => m.id === m1.id).length;
    assert.strictEqual(count, 1, 'expected exactly one entry for m1');
  });

  // 5. Memory with no note match is not in results for a note-only query
  await test('memory with non-matching note not returned', async () => {
    const { body } = await req('GET', '/api/search?q=xyzuniquenote');
    assert.ok(!body.some(m => m.id === m3.id), 'expected m3 NOT in results');
  });

  // 6. Search returns 200
  await test('GET /api/search returns 200', async () => {
    const { status } = await req('GET', '/api/search?q=xyzuniquenote');
    assert.strictEqual(status, 200);
  });

  // 7. Note-only term search (term only in note, not title/content)
  await test('term found only in note is returned', async () => {
    // m1 has 'xyzuniquenote' only in note (content is 'general content')
    const { body } = await req('GET', '/api/search?q=xyzuniquenote');
    assert.ok(body.some(m => m.id === m1.id), 'note-only match should be in results');
  });

  // 8. Partial note term match
  await test('partial note term match works', async () => {
    // 'completely different' is m3's note — search for 'completely'
    const { body } = await req('GET', '/api/search?q=completely');
    assert.ok(body.some(m => m.id === m3.id), 'expected m3 via partial note match');
  });

  // 9. Search for term not in any note, title, or content returns empty
  await test('search for absent term returns empty', async () => {
    const { body } = await req('GET', '/api/search?q=zzznomatch99999');
    assert.ok(Array.isArray(body) && body.length === 0, 'expected empty results');
  });

  // 10. HTML has note search capability acknowledged (search box still present)
  await test('HTML search input still present', async () => {
    const { body: html } = await req('GET', '/');
    assert.ok(html.includes('id="q"') && html.includes('doSearch'), 'expected search input #q in HTML');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
