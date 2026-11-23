'use strict';
const assert = require('assert');
const http   = require('http');
const path   = require('path');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p109-${Date.now()}.db`);

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

  console.log('\nPhase 109 — Memory Restore from Archive\n');

  // Seed and archive a memory
  const { body: m1 } = await req('POST', '/api/memories', { title: 'ToRestore', content: 'restore me content', memory_type: 'core' });
  await req('DELETE', `/api/memories/${m1.id}`);  // archives it

  // 1. restore endpoint returns 200
  await test('POST /restore returns 200', async () => {
    const { status } = await req('POST', `/api/memories/${m1.id}/restore`);
    assert.strictEqual(status, 200);
  });

  // 2. restored memory has status active
  await test('restored memory has status active', async () => {
    const { body } = await req('GET', `/api/memories/${m1.id}`);
    assert.strictEqual(body.status, 'active');
  });

  // 3. restored memory appears in active list
  await test('restored memory appears in active list', async () => {
    const { body } = await req('GET', '/api/memories?limit=1000');
    assert.ok(body.some(m => m.id === m1.id), 'restored memory should be in active list');
  });

  // 4. restoring an already-active memory is idempotent (200)
  await test('restoring active memory is idempotent', async () => {
    const { status } = await req('POST', `/api/memories/${m1.id}/restore`);
    assert.strictEqual(status, 200);
    const { body } = await req('GET', `/api/memories/${m1.id}`);
    assert.strictEqual(body.status, 'active');
  });

  // 5. restoring non-existent id returns 404
  await test('restoring non-existent id returns 404', async () => {
    const { status } = await req('POST', '/api/memories/nonexistent-id-xyz/restore');
    assert.strictEqual(status, 404);
  });

  // 6. bulk restore action returns 200
  await test('bulk restore returns 200', async () => {
    const { body: m2 } = await req('POST', '/api/memories', { title: 'BulkRestore', content: 'bulk restore content', memory_type: 'core' });
    await req('DELETE', `/api/memories/${m2.id}`);
    const { status } = await req('POST', '/api/memories/bulk', { ids: [m2.id], action: 'restore' });
    assert.strictEqual(status, 200);
  });

  // 7. bulk restore returns count
  await test('bulk restore returns count', async () => {
    const { body: m3 } = await req('POST', '/api/memories', { title: 'BulkR2', content: 'bulk restore 2 content', memory_type: 'core' });
    await req('DELETE', `/api/memories/${m3.id}`);
    const { body } = await req('POST', '/api/memories/bulk', { ids: [m3.id], action: 'restore' });
    assert.ok('count' in body && body.count >= 1, `expected count >= 1, got ${body.count}`);
  });

  // 8. status=archived filter returns archived memories
  await test('status=archived filter returns archived memories', async () => {
    const { body: ma } = await req('POST', '/api/memories', { title: 'ArchivedOne', content: 'archived content here', memory_type: 'core' });
    await req('DELETE', `/api/memories/${ma.id}`);
    const { body } = await req('GET', '/api/memories?status=archived&limit=1000');
    assert.ok(Array.isArray(body), 'expected array');
    assert.ok(body.some(m => m.id === ma.id), 'archived memory should appear in archived filter');
  });

  const html = (await req('GET', '/')).body;

  // 9. HTML has restoreMemory function
  await test('HTML has restoreMemory function', async () => {
    assert.ok(html.includes('restoreMemory'), 'expected restoreMemory in HTML');
  });

  // 10. HTML has marchived checkbox
  await test('HTML has marchived checkbox', async () => {
    assert.ok(html.includes('marchived'), 'expected marchived checkbox in HTML');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
