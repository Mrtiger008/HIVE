'use strict';
const assert = require('assert');
const http   = require('http');
const path   = require('path');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p71-${Date.now()}.db`);

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

  console.log('\nPhase 71 — Bulk Label\n');

  // Seed three memories
  const { body: m1 } = await req('POST', '/api/memories', { title: 'Bulk A', content: 'x', memory_type: 'core' });
  const { body: m2 } = await req('POST', '/api/memories', { title: 'Bulk B', content: 'x', memory_type: 'core' });
  const { body: m3 } = await req('POST', '/api/memories', { title: 'Bulk C', content: 'x', memory_type: 'core' });

  const html = (await req('GET', '/')).body;

  // 1. dashboard has #bulk-label select
  await test('dashboard has #bulk-label select', async () => {
    assert.ok(html.includes('id="bulk-label"'), 'expected bulk-label select in HTML');
  });

  // 2. bulk-label select has color options
  await test('bulk-label select has 🔴/🟡/🟢/🔵 options', async () => {
    assert.ok(html.includes('🔴 Red'), 'expected red option');
    assert.ok(html.includes('🟡 Yellow'), 'expected yellow option');
    assert.ok(html.includes('🟢 Green'), 'expected green option');
    assert.ok(html.includes('🔵 Blue'), 'expected blue option');
  });

  // 3. bulk-label has a "Remove label" clear option
  await test('bulk-label has remove/clear label option', async () => {
    assert.ok(html.includes('__clear__') || html.includes('Remove label'), 'expected clear option');
  });

  // 4. dashboard has bulkLabel function
  await test('dashboard has bulkLabel function', async () => {
    assert.ok(html.includes('function bulkLabel('), 'expected bulkLabel in HTML');
  });

  // 5. bulk update with label applies to all selected memories
  await test('POST /api/memories/bulk action:update label sets label on multiple', async () => {
    const { status, body } = await req('POST', '/api/memories/bulk', {
      ids: [m1.id, m2.id], action: 'update', updates: { label: 'green' }
    });
    assert.strictEqual(status, 200);
    assert.ok(body.count >= 2, `expected count>=2, got ${body.count}`);
  });

  // 6. label persists after bulk update
  await test('label persists on each memory after bulk update', async () => {
    const r1 = await req('GET', `/api/memories/${m1.id}`);
    const r2 = await req('GET', `/api/memories/${m2.id}`);
    assert.strictEqual(r1.body.label, 'green', `m1 label should be green, got ${r1.body.label}`);
    assert.strictEqual(r2.body.label, 'green', `m2 label should be green, got ${r2.body.label}`);
  });

  // 7. un-selected memory is not affected
  await test('non-selected memory label remains unchanged', async () => {
    const r3 = await req('GET', `/api/memories/${m3.id}`);
    assert.ok(!r3.body.label, `m3 should have no label, got ${r3.body.label}`);
  });

  // 8. bulk update with label:null clears labels
  await test('bulk update label:null clears labels', async () => {
    const { status } = await req('POST', '/api/memories/bulk', {
      ids: [m1.id, m2.id], action: 'update', updates: { label: null }
    });
    assert.strictEqual(status, 200);
    const r1 = await req('GET', `/api/memories/${m1.id}`);
    assert.ok(!r1.body.label, `label should be cleared, got ${r1.body.label}`);
  });

  // 9. bulk bar HTML has Apply label button
  await test('bulk bar has Apply label button calling bulkLabel()', async () => {
    assert.ok(html.includes('onclick="bulkLabel()"'), 'expected onclick=bulkLabel()');
    assert.ok(html.includes('Apply label'), 'expected Apply label button text');
  });

  // 10. all four label colors work via bulk update
  await test('all four label colors accepted via bulk update', async () => {
    for (const color of ['red', 'yellow', 'green', 'blue']) {
      const { status } = await req('POST', '/api/memories/bulk', {
        ids: [m3.id], action: 'update', updates: { label: color }
      });
      assert.strictEqual(status, 200, `expected 200 for label=${color}`);
      const r = await req('GET', `/api/memories/${m3.id}`);
      assert.strictEqual(r.body.label, color, `expected label=${color}`);
    }
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
