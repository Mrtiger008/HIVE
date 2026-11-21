'use strict';
const assert = require('assert');
const http   = require('http');
const path   = require('path');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p86-${Date.now()}.db`);

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

  console.log('\nPhase 86 — Search in Notes Only\n');

  // m1: term in note only; m2: term in content only; m3: term in both
  const term = 'uniquenotesearchterm86x';
  const { body: m1 } = await req('POST', '/api/memories', { title: 'Note-only', content: 'generic content', memory_type: 'core', note: term });
  const { body: m2 } = await req('POST', '/api/memories', { title: 'Content-only', content: `content has ${term}`, memory_type: 'core' });
  const { body: m3 } = await req('POST', '/api/memories', { title: 'Both', content: `content has ${term}`, memory_type: 'core', note: term });

  // 1. notes_only=1 returns note-match memory
  await test('notes_only=1 returns memory with term in note', async () => {
    const { body } = await req('GET', `/api/search?q=${term}&notes_only=1`);
    assert.ok(body.some(m => m.id === m1.id), 'expected m1 (note-only) in notes_only results');
  });

  // 2. notes_only=1 excludes content-only match
  await test('notes_only=1 excludes content-only memory', async () => {
    const { body } = await req('GET', `/api/search?q=${term}&notes_only=1`);
    assert.ok(!body.some(m => m.id === m2.id), 'expected m2 (content-only) NOT in notes_only results');
  });

  // 3. notes_only=1 includes memory with term in both note and content
  await test('notes_only=1 includes memory with term in both', async () => {
    const { body } = await req('GET', `/api/search?q=${term}&notes_only=1`);
    assert.ok(body.some(m => m.id === m3.id), 'expected m3 (both) in notes_only results');
  });

  // 4. normal search (no notes_only) returns all three
  await test('normal search returns all three memories', async () => {
    const { body } = await req('GET', `/api/search?q=${term}`);
    assert.ok(body.some(m => m.id === m1.id) && body.some(m => m.id === m2.id) && body.some(m => m.id === m3.id));
  });

  // 5. notes_only=1 returns 200
  await test('GET /api/search?notes_only=1 returns 200', async () => {
    const { status } = await req('GET', `/api/search?q=${term}&notes_only=1`);
    assert.strictEqual(status, 200);
  });

  // 6. notes_only=1 with no notes returns empty
  await test('notes_only=1 with term not in any note returns empty', async () => {
    const { body } = await req('GET', '/api/search?q=zzznomatchnote99x&notes_only=1');
    assert.ok(Array.isArray(body) && body.length === 0);
  });

  const html = (await req('GET', '/')).body;

  // 7. HTML has snotes checkbox
  await test('HTML has snotes checkbox', async () => {
    assert.ok(html.includes('id="snotes"'), 'expected #snotes checkbox in HTML');
  });

  // 8. HTML has notes only label
  await test('HTML has notes only label text', async () => {
    assert.ok(html.includes('notes only'), 'expected "notes only" label text');
  });

  // 9. doSearch uses snotes checkbox
  await test('doSearch references snotes', async () => {
    assert.ok(html.includes("g('snotes')") || html.includes('g("snotes")'), 'expected snotes referenced in doSearch');
  });

  // 10. notes_only=0 behaves like no notes_only param
  await test('notes_only=0 returns content-only match', async () => {
    const { body } = await req('GET', `/api/search?q=${term}&notes_only=0`);
    assert.ok(body.some(m => m.id === m2.id), 'expected m2 in results when notes_only=0');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
