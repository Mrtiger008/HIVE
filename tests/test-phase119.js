'use strict';
const assert = require('assert');
const http   = require('http');
const path   = require('path');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p119-${Date.now()}.db`);

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

  console.log('\nPhase 119 — Importance Quick-Bump\n');

  // Seed a memory with known importance
  const { body: m } = await req('POST', '/api/memories', { title: 'P119-BumpTest', content: 'bump importance test', memory_type: 'core', importance: 5 });

  // 1. memory created with importance 5
  await test('memory created with importance 5', async () => {
    assert.strictEqual(m.importance, 5);
  });

  // 2. PUT /api/memories/:id with importance increments it
  await test('PUT importance to 6', async () => {
    const { body } = await req('PUT', `/api/memories/${m.id}`, { importance: 6 });
    assert.strictEqual(body.importance, 6);
  });

  // 3. PUT importance to 10 (max)
  await test('PUT importance to 10 (max allowed)', async () => {
    const { body } = await req('PUT', `/api/memories/${m.id}`, { importance: 10 });
    assert.strictEqual(body.importance, 10);
  });

  // 4. PUT importance to 1 (min)
  await test('PUT importance to 1 (min allowed)', async () => {
    const { body } = await req('PUT', `/api/memories/${m.id}`, { importance: 1 });
    assert.strictEqual(body.importance, 1);
  });

  // 5. GET after update reflects new importance
  await test('GET memory reflects updated importance', async () => {
    await req('PUT', `/api/memories/${m.id}`, { importance: 7 });
    const { body } = await req('GET', `/api/memories/${m.id}`);
    assert.strictEqual(body.importance, 7);
  });

  // 6. importance update does not change other fields
  await test('importance bump preserves title and content', async () => {
    const { body } = await req('PUT', `/api/memories/${m.id}`, { importance: 8 });
    assert.strictEqual(body.title, 'P119-BumpTest');
    assert.ok(body.content.includes('bump importance'));
  });

  // 7. importance can be set back to 5
  await test('importance can be set to 5 again', async () => {
    const { body } = await req('PUT', `/api/memories/${m.id}`, { importance: 5 });
    assert.strictEqual(body.importance, 5);
  });

  const html = (await req('GET', '/')).body;

  // 8. HTML has bumpImportance function
  await test('HTML has bumpImportance function', async () => {
    assert.ok(html.includes('bumpImportance'), 'expected bumpImportance in HTML');
  });

  // 9. HTML has importance badge with id="imp-" prefix
  await test('HTML card uses imp-${id} badge id', async () => {
    assert.ok(html.includes("'imp-'") || html.includes('"imp-"') || html.includes('imp-\\${m.id}') || html.includes("imp-'+id") || html.includes('id="imp-'),
      'expected imp-${id} badge id pattern in HTML');
  });

  // 10. HTML has ▲ and ▼ bump buttons
  await test('HTML has ▲ and ▼ importance bump buttons', async () => {
    assert.ok(html.includes('▲') && html.includes('▼'), 'expected ▲ and ▼ buttons in HTML');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
