'use strict';
const assert = require('assert');
const http   = require('http');
const path   = require('path');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p96-${Date.now()}.db`);

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

  console.log('\nPhase 96 — Memory Read Status\n');

  // Seed two memories
  const { body: m1 } = await req('POST', '/api/memories', { title: 'Read me', content: 'alpha content here', memory_type: 'core' });
  const { body: m2 } = await req('POST', '/api/memories', { title: 'Unread me', content: 'beta content here', memory_type: 'core' });

  // 1. mark-read returns 200
  await test('POST mark-read returns 200', async () => {
    const { status } = await req('POST', `/api/memories/${m1.id}/mark-read`);
    assert.strictEqual(status, 200);
  });

  // 2. read_at is set after marking read
  await test('read_at is set after mark-read', async () => {
    const { body } = await req('GET', `/api/memories/${m1.id}`);
    assert.ok(body.read_at && body.read_at > 0, 'read_at should be a positive timestamp');
  });

  // 3. mark-unread returns 200
  await test('POST mark-unread returns 200', async () => {
    const { status } = await req('POST', `/api/memories/${m1.id}/mark-unread`);
    assert.strictEqual(status, 200);
  });

  // 4. read_at is null after marking unread
  await test('read_at is null after mark-unread', async () => {
    const { body } = await req('GET', `/api/memories/${m1.id}`);
    assert.ok(!body.read_at, 'read_at should be null/falsy after mark-unread');
  });

  // 5. mark m1 read, then unread filter returns only m2
  await test('unread filter excludes read memories', async () => {
    await req('POST', `/api/memories/${m1.id}/mark-read`);
    const { body } = await req('GET', `/api/memories?unread=1&limit=1000`);
    const ids = body.map(m => m.id);
    assert.ok(!ids.includes(m1.id), 'm1 (read) should not appear in unread filter');
    assert.ok(ids.includes(m2.id), 'm2 (unread) should appear in unread filter');
  });

  // 6. after marking m2 read, unread filter returns empty (for these two)
  await test('unread filter is empty when all are read', async () => {
    await req('POST', `/api/memories/${m2.id}/mark-read`);
    const { body } = await req('GET', `/api/memories?unread=1&limit=1000`);
    const ids = body.map(m => m.id);
    assert.ok(!ids.includes(m1.id) && !ids.includes(m2.id), 'neither should appear when both are read');
  });

  // 7. mark-read on unknown id returns 404
  await test('mark-read on unknown id returns 404', async () => {
    const { status } = await req('POST', '/api/memories/nonexistent-id-xyz/mark-read');
    assert.strictEqual(status, 404);
  });

  // 8. memories default to unread (read_at null) on creation
  await test('new memory has null read_at', async () => {
    const { body: m3 } = await req('POST', '/api/memories', { title: 'New memory', content: 'fresh content', memory_type: 'core' });
    assert.ok(!m3.read_at, 'newly created memory should have null read_at');
  });

  const html = (await req('GET', '/')).body;

  // 9. HTML has munread checkbox
  await test('HTML has munread unread filter checkbox', async () => {
    assert.ok(html.includes('munread'), 'expected munread checkbox id in HTML');
  });

  // 10. HTML has toggleRead function
  await test('HTML has toggleRead function', async () => {
    assert.ok(html.includes('toggleRead'), 'expected toggleRead function in HTML');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
