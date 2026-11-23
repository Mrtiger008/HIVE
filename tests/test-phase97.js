'use strict';
const assert = require('assert');
const http   = require('http');
const path   = require('path');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p97-${Date.now()}.db`);

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

  console.log('\nPhase 97 — Memory Age Filter\n');

  // Seed a fresh memory (created_at = now)
  const { body: m1 } = await req('POST', '/api/memories', { title: 'Fresh memory', content: 'created today', memory_type: 'core' });

  // 1. age=7d returns 200
  await test('age=7d returns 200', async () => {
    const { status } = await req('GET', '/api/memories?age=7d&limit=100');
    assert.strictEqual(status, 200);
  });

  // 2. age=7d returns array
  await test('age=7d returns array', async () => {
    const { body } = await req('GET', '/api/memories?age=7d&limit=100');
    assert.ok(Array.isArray(body));
  });

  // 3. fresh memory appears in age=7d
  await test('fresh memory appears in age=7d', async () => {
    const { body } = await req('GET', '/api/memories?age=7d&limit=1000');
    assert.ok(body.some(m => m.id === m1.id), 'just-created memory should appear in last-7-days filter');
  });

  // 4. fresh memory appears in age=30d
  await test('fresh memory appears in age=30d', async () => {
    const { body } = await req('GET', '/api/memories?age=30d&limit=1000');
    assert.ok(body.some(m => m.id === m1.id), 'just-created memory should appear in last-30-days filter');
  });

  // 5. fresh memory appears in age=90d
  await test('fresh memory appears in age=90d', async () => {
    const { body } = await req('GET', '/api/memories?age=90d&limit=1000');
    assert.ok(body.some(m => m.id === m1.id));
  });

  // 6. fresh memory does NOT appear in age=old (older than 90 days)
  await test('fresh memory absent from age=old filter', async () => {
    const { body } = await req('GET', '/api/memories?age=old&limit=1000');
    assert.ok(!body.some(m => m.id === m1.id), 'just-created memory should not appear in older-than-90d filter');
  });

  // 7. age=old returns array (may be empty for fresh DB)
  await test('age=old returns array', async () => {
    const { body } = await req('GET', '/api/memories?age=old&limit=100');
    assert.ok(Array.isArray(body));
  });

  // 8. age can combine with type filter
  await test('age filter combines with type filter', async () => {
    const { body } = await req('GET', '/api/memories?age=7d&type=core&limit=1000');
    assert.ok(Array.isArray(body));
    assert.ok(body.every(m => m.memory_type === 'core'));
  });

  const html = (await req('GET', '/')).body;

  // 9. HTML has mage select element
  await test('HTML has mage age filter select', async () => {
    assert.ok(html.includes('id="mage"') || html.includes("id='mage'"), 'expected mage select in HTML');
  });

  // 10. HTML has age filter options (last 7 days, 30 days, etc.)
  await test('HTML has age filter options', async () => {
    assert.ok(html.includes('Last 7 days') || html.includes('7d'), 'expected age options in HTML');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
