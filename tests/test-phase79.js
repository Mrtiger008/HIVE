'use strict';
const assert = require('assert');
const http   = require('http');
const path   = require('path');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p79-${Date.now()}.db`);

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

  console.log('\nPhase 79 — Tag Rename Across All Memories\n');

  // Seed 3 memories: 2 with 'oldtag', 1 without
  const { body: m1 } = await req('POST', '/api/memories', { title: 'A', content: 'x', memory_type: 'core', tags: ['oldtag', 'keep'] });
  const { body: m2 } = await req('POST', '/api/memories', { title: 'B', content: 'x', memory_type: 'core', tags: ['oldtag'] });
  const { body: m3 } = await req('POST', '/api/memories', { title: 'C', content: 'x', memory_type: 'core', tags: ['other'] });

  // 1. POST /api/tags/rename returns 200 with updated count
  await test('POST /api/tags/rename returns {renamed, to, updated}', async () => {
    const { status, body } = await req('POST', '/api/tags/rename', { from: 'oldtag', to: 'newtag' });
    assert.strictEqual(status, 200);
    assert.strictEqual(body.renamed, 'oldtag');
    assert.strictEqual(body.to, 'newtag');
    assert.strictEqual(body.updated, 2);
  });

  // 2. memories with oldtag now have newtag
  await test('renamed memories now have newtag', async () => {
    const { body: a } = await req('GET', `/api/memories/${m1.id}`);
    assert.ok(a.tags.includes('newtag'), 'expected newtag in m1');
    assert.ok(!a.tags.includes('oldtag'), 'oldtag should be gone from m1');
  });

  // 3. other tags on the same memory are preserved
  await test('other tags preserved after rename', async () => {
    const { body: a } = await req('GET', `/api/memories/${m1.id}`);
    assert.ok(a.tags.includes('keep'), 'keep tag should still be there');
  });

  // 4. memory without oldtag is unaffected
  await test('memory without the tag is unaffected', async () => {
    const { body: c } = await req('GET', `/api/memories/${m3.id}`);
    assert.deepStrictEqual(c.tags, ['other']);
  });

  // 5. /api/tags no longer lists oldtag
  await test('/api/tags no longer lists oldtag', async () => {
    const { body } = await req('GET', '/api/tags');
    assert.ok(!body.some(t => t.tag === 'oldtag'), 'oldtag should not appear in tags');
    assert.ok(body.some(t => t.tag === 'newtag'), 'newtag should appear in tags');
  });

  // 6. rename with same from/to returns 400
  await test('rename from===to returns 400', async () => {
    const { status } = await req('POST', '/api/tags/rename', { from: 'newtag', to: 'newtag' });
    assert.strictEqual(status, 400);
  });

  // 7. rename missing from returns 400
  await test('rename missing from returns 400', async () => {
    const { status } = await req('POST', '/api/tags/rename', { to: 'newtag' });
    assert.strictEqual(status, 400);
  });

  // 8. tag name is normalized (trimmed, lowercased, spaces→hyphens)
  await test('tag name is normalized on rename', async () => {
    await req('POST', '/api/memories', { title: 'D', content: 'x', memory_type: 'core', tags: ['camel'] });
    const { body } = await req('POST', '/api/tags/rename', { from: 'camel', to: 'CamelCase Tag' });
    assert.strictEqual(body.to, 'camelcase-tag');
  });

  const html = (await req('GET', '/')).body;

  // 9. HTML has renameTagGlobal function
  await test('HTML has renameTagGlobal function', async () => {
    assert.ok(html.includes('async function renameTagGlobal('), 'expected renameTagGlobal function');
  });

  // 10. tag cloud toolbar has rename button
  await test('tag cloud has rename button', async () => {
    assert.ok(html.includes("onclick=\"renameTagGlobal()\""), 'expected rename button in tag cloud');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
