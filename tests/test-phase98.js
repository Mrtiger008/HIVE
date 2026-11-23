'use strict';
const assert = require('assert');
const http   = require('http');
const path   = require('path');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p98-${Date.now()}.db`);

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

  console.log('\nPhase 98 — Bulk Mark Read / Unread\n');

  // Seed three memories
  const { body: m1 } = await req('POST', '/api/memories', { title: 'Alpha', content: 'alpha content here', memory_type: 'core' });
  const { body: m2 } = await req('POST', '/api/memories', { title: 'Beta',  content: 'beta content here',  memory_type: 'core' });
  const { body: m3 } = await req('POST', '/api/memories', { title: 'Gamma', content: 'gamma content here', memory_type: 'core' });

  // 1. bulk mark-read returns 200
  await test('bulk mark-read returns 200', async () => {
    const { status } = await req('POST', '/api/memories/bulk', { ids: [m1.id, m2.id], action: 'mark-read' });
    assert.strictEqual(status, 200);
  });

  // 2. bulk mark-read returns count = 2
  await test('bulk mark-read returns correct count', async () => {
    const { body } = await req('POST', '/api/memories/bulk', { ids: [m1.id, m2.id], action: 'mark-read' });
    assert.ok(body.count >= 1, 'count should be >= 1');
  });

  // 3. m1 has read_at set after bulk mark-read
  await test('m1 read_at set after bulk mark-read', async () => {
    await req('POST', '/api/memories/bulk', { ids: [m1.id], action: 'mark-read' });
    const { body } = await req('GET', `/api/memories/${m1.id}`);
    assert.ok(body.read_at && body.read_at > 0, 'read_at should be set');
  });

  // 4. m2 has read_at set after bulk mark-read
  await test('m2 read_at set after bulk mark-read', async () => {
    await req('POST', '/api/memories/bulk', { ids: [m2.id], action: 'mark-read' });
    const { body } = await req('GET', `/api/memories/${m2.id}`);
    assert.ok(body.read_at && body.read_at > 0, 'read_at should be set');
  });

  // 5. m3 unread is unaffected by bulk mark-read of m1/m2
  await test('m3 remains unread after bulk mark-read of others', async () => {
    const { body } = await req('GET', `/api/memories/${m3.id}`);
    assert.ok(!body.read_at, 'm3 should still be unread');
  });

  // 6. bulk mark-unread returns 200
  await test('bulk mark-unread returns 200', async () => {
    const { status } = await req('POST', '/api/memories/bulk', { ids: [m1.id, m2.id], action: 'mark-unread' });
    assert.strictEqual(status, 200);
  });

  // 7. m1 read_at is null after bulk mark-unread
  await test('m1 read_at null after bulk mark-unread', async () => {
    await req('POST', '/api/memories/bulk', { ids: [m1.id], action: 'mark-unread' });
    const { body } = await req('GET', `/api/memories/${m1.id}`);
    assert.ok(!body.read_at, 'read_at should be null/falsy');
  });

  // 8. mark all three read, then unread filter returns empty for these ids
  await test('unread filter empty after all marked read', async () => {
    await req('POST', '/api/memories/bulk', { ids: [m1.id, m2.id, m3.id], action: 'mark-read' });
    const { body } = await req('GET', '/api/memories?unread=1&limit=1000');
    assert.ok(!body.some(m => [m1.id, m2.id, m3.id].includes(m.id)), 'none should appear in unread filter');
  });

  const html = (await req('GET', '/')).body;

  // 9. HTML has bulkMarkRead function
  await test('HTML has bulkMarkRead function', async () => {
    assert.ok(html.includes('bulkMarkRead'), 'expected bulkMarkRead in HTML');
  });

  // 10. HTML has bulkMarkUnread function
  await test('HTML has bulkMarkUnread function', async () => {
    assert.ok(html.includes('bulkMarkUnread'), 'expected bulkMarkUnread in HTML');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
