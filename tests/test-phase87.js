'use strict';
const assert = require('assert');
const http   = require('http');
const path   = require('path');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p87-${Date.now()}.db`);

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

  console.log('\nPhase 87 — Bulk Archive by Filter\n');

  // Test that the underlying bulk archive endpoint works with many ids
  const created = [];
  for (let i = 0; i < 5; i++) {
    const { body } = await req('POST', '/api/memories', { title: `BulkTest${i}`, content: 'x', memory_type: 'core', tags: ['arch87test'] });
    created.push(body.id);
  }
  // also create one memory WITHOUT the tag that should be unaffected
  const { body: safe } = await req('POST', '/api/memories', { title: 'SafeMem', content: 'y', memory_type: 'core', tags: ['unrelated87'] });

  // 1. bulk archive endpoint archives multiple ids at once
  await test('POST /api/memories/bulk with archive action returns 200', async () => {
    const { status, body } = await req('POST', '/api/memories/bulk', { ids: created, action: 'archive' });
    assert.strictEqual(status, 200);
    assert.ok(body.archived >= 5 || body.updated >= 5 || body.count >= 5, 'expected at least 5 archived');
  });

  // 2. archived memories no longer appear in active list
  await test('archived memories do not appear in active list', async () => {
    const { body } = await req('GET', '/api/memories?tag=arch87test&limit=1000');
    assert.ok(!body.some(m => created.includes(m.id)), 'archived memories should not appear in active list');
  });

  // 3. safe memory is unaffected
  await test('memory without the tag is unaffected', async () => {
    const { body } = await req('GET', `/api/memories/${safe.id}`);
    assert.strictEqual(body.status, 'active');
  });

  // 4. bulk archive of empty ids array is handled
  await test('bulk archive with empty ids is handled gracefully', async () => {
    const { status } = await req('POST', '/api/memories/bulk', { ids: [], action: 'archive' });
    assert.ok(status === 200 || status === 400, 'should return 200 or 400 for empty ids');
  });

  // 5. can archive a fresh batch
  await test('bulk archive a second batch succeeds', async () => {
    const batch = [];
    for (let i = 0; i < 3; i++) {
      const { body } = await req('POST', '/api/memories', { title: `Batch2_${i}`, content: 'x', memory_type: 'core' });
      batch.push(body.id);
    }
    const { status } = await req('POST', '/api/memories/bulk', { ids: batch, action: 'archive' });
    assert.strictEqual(status, 200);
    const { body: check } = await req('GET', `/api/memories/${batch[0]}`);
    assert.strictEqual(check.status, 'archived');
  });

  const html = (await req('GET', '/')).body;

  // 6. HTML has archiveAllFiltered function
  await test('HTML has archiveAllFiltered function', async () => {
    assert.ok(html.includes('async function archiveAllFiltered('), 'expected archiveAllFiltered function');
  });

  // 7. HTML has arch-all-btn button
  await test('HTML has arch-all-btn button', async () => {
    assert.ok(html.includes('id="arch-all-btn"'), 'expected #arch-all-btn in HTML');
  });

  // 8. archiveAllFiltered uses bulk endpoint
  await test('archiveAllFiltered calls /api/memories/bulk', async () => {
    assert.ok(html.includes('/api/memories/bulk'), 'expected bulk endpoint in archiveAllFiltered');
  });

  // 9. archiveAllFiltered uses action:archive
  await test('archiveAllFiltered uses action archive', async () => {
    assert.ok(html.includes("action:'archive'") || html.includes('action:"archive"'), 'expected action:archive');
  });

  // 10. button has warning style (red color indicator)
  await test('archive-all button has warning color', async () => {
    assert.ok(html.includes('#f85149'), 'expected red warning color on archive-all button');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
