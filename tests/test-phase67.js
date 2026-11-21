'use strict';
const assert = require('assert');
const http   = require('http');
const path   = require('path');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p67-${Date.now()}.db`);

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

  console.log('\nPhase 67 — Memory Color Labels\n');

  // Create two test memories
  const { body: m1 } = await req('POST', '/api/memories', { title: 'Red memory', content: 'Important urgent thing', memory_type: 'core' });
  const { body: m2 } = await req('POST', '/api/memories', { title: 'Blue memory', content: 'Reference data point', memory_type: 'domain' });

  // 1. PUT /api/memories/:id accepts label field
  await test('PUT /api/memories/:id accepts label field', async () => {
    const { status, body } = await req('PUT', `/api/memories/${m1.id}`, { label: 'red' });
    assert.strictEqual(status, 200, `expected 200, got ${status}`);
    assert.strictEqual(body.label, 'red', `expected label=red, got ${body.label}`);
  });

  // 2. label persists — GET /api/memories/:id returns updated label
  await test('label persists on GET /api/memories/:id', async () => {
    const { body } = await req('GET', `/api/memories/${m1.id}`);
    assert.strictEqual(body.label, 'red', `expected label=red, got ${body.label}`);
  });

  // 3. different label colors accepted
  await test('blue label accepted', async () => {
    const { status, body } = await req('PUT', `/api/memories/${m2.id}`, { label: 'blue' });
    assert.strictEqual(status, 200);
    assert.strictEqual(body.label, 'blue');
  });

  // 4. label can be cleared (set to null/empty)
  await test('label cleared when set to null', async () => {
    // Clone m2 for clearing test
    const { body: m3 } = await req('POST', '/api/memories', { title: 'Temp label', content: 'x', memory_type: 'core' });
    await req('PUT', `/api/memories/${m3.id}`, { label: 'green' });
    const { body: cleared } = await req('PUT', `/api/memories/${m3.id}`, { label: null });
    assert.ok(cleared.label === null || cleared.label === undefined || cleared.label === '', `label should be cleared, got ${cleared.label}`);
  });

  // 5. GET /api/memories?label=red filters correctly
  await test('GET /api/memories?label=red returns only red memories', async () => {
    const { body: results } = await req('GET', '/api/memories?label=red&limit=100');
    assert.ok(Array.isArray(results), 'expected array');
    assert.ok(results.length >= 1, 'expected at least 1 red memory');
    assert.ok(results.every(m => m.label === 'red'), 'all results should have label=red');
  });

  // 6. label filter excludes non-matching memories
  await test('label=blue excludes red memories', async () => {
    const { body: results } = await req('GET', '/api/memories?label=blue&limit=100');
    assert.ok(Array.isArray(results));
    assert.ok(results.every(m => m.label === 'blue'), 'all results should have label=blue');
    assert.ok(!results.some(m => m.label === 'red'), 'red memories should not appear');
  });

  // 7. dashboard HTML has #mlabel select element
  const html = (await req('GET', '/')).body;
  await test('dashboard has #mlabel select filter', async () => {
    assert.ok(html.includes('id="mlabel"'), 'expected mlabel select in HTML');
  });

  // 8. dashboard HTML has setLabel function
  await test('dashboard has setLabel function', async () => {
    assert.ok(html.includes('setLabel'), 'expected setLabel function in HTML');
  });

  // 9. dashboard card includes label select (🏷)
  await test('card HTML includes label select with 🏷 placeholder', async () => {
    assert.ok(html.includes('🏷 label'), 'expected 🏷 label option in card');
  });

  // 10. dashboard includes color options for labels
  await test('card HTML includes red/yellow/green/blue color options', async () => {
    assert.ok(html.includes('🔴 red'), 'expected 🔴 red option');
    assert.ok(html.includes('🟡 yellow'), 'expected 🟡 yellow option');
    assert.ok(html.includes('🟢 green'), 'expected 🟢 green option');
    assert.ok(html.includes('🔵 blue'), 'expected 🔵 blue option');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
