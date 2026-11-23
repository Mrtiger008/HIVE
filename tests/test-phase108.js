'use strict';
const assert = require('assert');
const http   = require('http');
const path   = require('path');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p108-${Date.now()}.db`);

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

  console.log('\nPhase 108 — Bulk Delete\n');

  // Seed three memories
  const { body: m1 } = await req('POST', '/api/memories', { title: 'Alpha', content: 'alpha content here', memory_type: 'core' });
  const { body: m2 } = await req('POST', '/api/memories', { title: 'Beta',  content: 'beta content here',  memory_type: 'core' });
  const { body: m3 } = await req('POST', '/api/memories', { title: 'Gamma', content: 'gamma content here', memory_type: 'core' });

  // 1. bulk delete returns 200
  await test('bulk delete returns 200', async () => {
    const { status } = await req('POST', '/api/memories/bulk', { ids: [m1.id], action: 'delete' });
    assert.strictEqual(status, 200);
  });

  // 2. bulk delete returns count
  await test('bulk delete returns count field', async () => {
    const { body } = await req('POST', '/api/memories/bulk', { ids: [m1.id], action: 'delete' });
    assert.ok('count' in body, 'expected count field');
    assert.ok(typeof body.count === 'number');
  });

  // 3. deleted memory no longer appears in active list
  await test('deleted memory absent from active list', async () => {
    await req('POST', '/api/memories/bulk', { ids: [m2.id], action: 'delete' });
    const { body } = await req('GET', '/api/memories?limit=1000');
    assert.ok(!body.some(m => m.id === m2.id), 'deleted memory should not appear in active list');
  });

  // 4. m3 (not deleted) still appears in list
  await test('non-deleted memory still in list', async () => {
    const { body } = await req('GET', '/api/memories?limit=1000');
    assert.ok(body.some(m => m.id === m3.id), 'm3 should still be active');
  });

  // 5. bulk delete of multiple IDs returns correct count
  await test('bulk delete multiple returns correct count', async () => {
    const { body: a } = await req('POST', '/api/memories', { title: 'DelA', content: 'del a content', memory_type: 'core' });
    const { body: b } = await req('POST', '/api/memories', { title: 'DelB', content: 'del b content', memory_type: 'core' });
    const { body: res } = await req('POST', '/api/memories/bulk', { ids: [a.id, b.id], action: 'delete' });
    assert.ok(res.count >= 2, `expected count >= 2, got ${res.count}`);
  });

  // 6. deleted memories show as archived (soft delete)
  await test('deleted memory has status archived', async () => {
    const { body: m } = await req('POST', '/api/memories', { title: 'ToDelete', content: 'will be deleted', memory_type: 'core' });
    await req('POST', '/api/memories/bulk', { ids: [m.id], action: 'delete' });
    const { body: fetched } = await req('GET', `/api/memories/${m.id}`);
    assert.strictEqual(fetched.status, 'archived', 'deleted memory should be archived');
  });

  // 7. empty ids returns 400
  await test('empty ids array returns 400', async () => {
    const { status } = await req('POST', '/api/memories/bulk', { ids: [], action: 'delete' });
    assert.strictEqual(status, 400);
  });

  // 8. delete action without ids returns 400
  await test('missing ids returns 400', async () => {
    const { status } = await req('POST', '/api/memories/bulk', { action: 'delete' });
    assert.strictEqual(status, 400);
  });

  const html = (await req('GET', '/')).body;

  // 9. HTML has bulkDelete function
  await test('HTML has bulkDelete function', async () => {
    assert.ok(html.includes('bulkDelete'), 'expected bulkDelete in HTML');
  });

  // 10. HTML has delete button in bulk bar
  await test('HTML has delete button in bulk bar', async () => {
    assert.ok(html.includes('action:\'delete\'') || html.includes('action:"delete"') || html.includes("action:'delete'"),
      'expected delete action in bulk POST call');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
