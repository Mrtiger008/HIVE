'use strict';
const assert = require('assert');
const http   = require('http');
const path   = require('path');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p84-${Date.now()}.db`);

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

  console.log('\nPhase 84 — Tag Merge\n');

  // Seed: m1 has [src, keep], m2 has [src], m3 has [src, dst], m4 has [other]
  const { body: m1 } = await req('POST', '/api/memories', { title: 'A', content: 'x', memory_type: 'core', tags: ['src', 'keep'] });
  const { body: m2 } = await req('POST', '/api/memories', { title: 'B', content: 'x', memory_type: 'core', tags: ['src'] });
  const { body: m3 } = await req('POST', '/api/memories', { title: 'C', content: 'x', memory_type: 'core', tags: ['src', 'dst'] });
  const { body: m4 } = await req('POST', '/api/memories', { title: 'D', content: 'x', memory_type: 'core', tags: ['other'] });

  // 1. POST /api/tags/merge returns 200 with updated count
  await test('POST /api/tags/merge returns {merged, into, updated}', async () => {
    const { status, body } = await req('POST', '/api/tags/merge', { from: 'src', into: 'dst' });
    assert.strictEqual(status, 200);
    assert.strictEqual(body.merged, 'src');
    assert.strictEqual(body.into, 'dst');
    assert.strictEqual(body.updated, 3);  // m1, m2, m3 all had src
  });

  // 2. merged memory no longer has src tag
  await test('merged memories no longer have src tag', async () => {
    const { body: a } = await req('GET', `/api/memories/${m1.id}`);
    assert.ok(!a.tags.includes('src'), 'src should be gone from m1');
  });

  // 3. merged memory now has dst tag
  await test('merged memories now have dst tag', async () => {
    const { body: a } = await req('GET', `/api/memories/${m2.id}`);
    assert.ok(a.tags.includes('dst'), 'dst should be in m2');
  });

  // 4. other tags preserved
  await test('other tags preserved after merge', async () => {
    const { body: a } = await req('GET', `/api/memories/${m1.id}`);
    assert.ok(a.tags.includes('keep'), 'keep tag should still be in m1');
  });

  // 5. memory with both src+dst gets src removed but only one dst
  await test('memory with both tags: src removed, dst not duplicated', async () => {
    const { body: c } = await req('GET', `/api/memories/${m3.id}`);
    assert.ok(!c.tags.includes('src'), 'src gone from m3');
    assert.strictEqual(c.tags.filter(t => t === 'dst').length, 1, 'dst appears exactly once');
  });

  // 6. memory without src tag is unaffected
  await test('memory without src is unaffected', async () => {
    const { body: d } = await req('GET', `/api/memories/${m4.id}`);
    assert.deepStrictEqual(d.tags, ['other']);
  });

  // 7. merge from===into returns 400
  await test('merge from===into returns 400', async () => {
    const { status } = await req('POST', '/api/tags/merge', { from: 'dst', into: 'dst' });
    assert.strictEqual(status, 400);
  });

  // 8. merge missing from returns 400
  await test('merge missing from returns 400', async () => {
    const { status } = await req('POST', '/api/tags/merge', { into: 'dst' });
    assert.strictEqual(status, 400);
  });

  const html = (await req('GET', '/')).body;

  // 9. HTML has mergeTagGlobal function
  await test('HTML has mergeTagGlobal function', async () => {
    assert.ok(html.includes('async function mergeTagGlobal('), 'expected mergeTagGlobal');
  });

  // 10. tag cloud toolbar has merge button
  await test('tag cloud has merge button', async () => {
    assert.ok(html.includes('onclick="mergeTagGlobal()"'), 'expected merge button in tag cloud');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
