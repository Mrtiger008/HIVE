'use strict';
const assert = require('assert');
const http   = require('http');
const path   = require('path');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p89-${Date.now()}.db`);

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

  console.log('\nPhase 89 — Memory Expiry Date\n');

  const future = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const past   = Date.now() - 7 * 24 * 60 * 60 * 1000;

  // 1. Create memory with expires_at returns 201
  let futureId, pastId;
  await test('POST with expires_at returns 201', async () => {
    const { status, body } = await req('POST', '/api/memories', { title: 'Exp Future', content: 'x', memory_type: 'core', expires_at: future });
    assert.strictEqual(status, 201);
    futureId = body.id;
  });

  // 2. Created memory has expires_at stored
  await test('expires_at is stored and returned', async () => {
    const { body } = await req('GET', '/api/memories/' + futureId);
    assert.ok(body.expires_at, 'expires_at should be set');
    assert.ok(Math.abs(body.expires_at - future) < 1000, 'expires_at value should match');
  });

  // 3. Create memory with past expires_at
  await test('POST with past expires_at returns 201', async () => {
    const { status, body } = await req('POST', '/api/memories', { title: 'Exp Past', content: 'x', memory_type: 'core', expires_at: past });
    assert.strictEqual(status, 201);
    pastId = body.id;
  });

  // 4. Past-expired memory has expires_at in the past
  await test('past expires_at is stored correctly', async () => {
    const { body } = await req('GET', '/api/memories/' + pastId);
    assert.ok(body.expires_at < Date.now(), 'expires_at should be in the past');
  });

  // 5. Update expires_at via PUT
  await test('PUT can update expires_at', async () => {
    const newExp = Date.now() + 30 * 24 * 60 * 60 * 1000;
    await req('PUT', '/api/memories/' + futureId, { expires_at: newExp });
    const { body } = await req('GET', '/api/memories/' + futureId);
    assert.ok(Math.abs(body.expires_at - newExp) < 1000, 'expires_at should be updated');
  });

  // 6. Clear expires_at by setting null
  await test('PUT with null clears expires_at', async () => {
    await req('PUT', '/api/memories/' + futureId, { expires_at: null });
    const { body } = await req('GET', '/api/memories/' + futureId);
    assert.strictEqual(body.expires_at, null, 'expires_at should be null after clearing');
  });

  // 7. Memory without expires_at has null expires_at
  await test('memory without expires_at has null expires_at', async () => {
    const { body: created } = await req('POST', '/api/memories', { title: 'No Expiry', content: 'x', memory_type: 'core' });
    const { body } = await req('GET', '/api/memories/' + created.id);
    assert.strictEqual(body.expires_at, null);
  });

  const html = (await req('GET', '/')).body;

  // 8. HTML has nm-ex input
  await test('HTML has expiry date input #nm-ex', async () => {
    assert.ok(html.includes('id="nm-ex"'), 'expected #nm-ex date input in HTML');
  });

  // 9. HTML references expires_at in showEdit
  await test('HTML wires expires_at in showEdit', async () => {
    assert.ok(html.includes('expires_at'), 'expected expires_at referenced in HTML');
  });

  // 10. HTML has expired badge logic
  await test('HTML has expired badge logic', async () => {
    assert.ok(html.includes('expiredBadge') || html.includes('expired'), 'expected expired badge in card template');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
