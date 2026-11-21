'use strict';
const assert = require('assert');
const http   = require('http');
const path   = require('path');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p74-${Date.now()}.db`);

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

  console.log('\nPhase 74 — Pinned Memories Count Badge\n');

  // Get baseline pinned count before seeding
  const { body: baseline } = await req('GET', '/api/stats');
  const basePinned = baseline.pinned;

  // Seed: 2 pinned, 1 unpinned
  const { body: m1 } = await req('POST', '/api/memories', { title: 'Pin A', content: 'x', memory_type: 'core' });
  const { body: m2 } = await req('POST', '/api/memories', { title: 'Pin B', content: 'x', memory_type: 'core' });
  const { body: m3 } = await req('POST', '/api/memories', { title: 'Unpin', content: 'x', memory_type: 'core' });
  await req('PUT', `/api/memories/${m1.id}`, { pinned: 1 });
  await req('PUT', `/api/memories/${m2.id}`, { pinned: 1 });

  // 1. /api/stats returns pinned field
  await test('/api/stats returns pinned field', async () => {
    const { status, body } = await req('GET', '/api/stats');
    assert.strictEqual(status, 200);
    assert.ok('pinned' in body, 'expected pinned field in stats');
  });

  // 2. pinned count is a number
  await test('pinned count is a number', async () => {
    const { body } = await req('GET', '/api/stats');
    assert.strictEqual(typeof body.pinned, 'number');
  });

  // 3. pinned count increased by 2 after pinning 2 memories
  await test('pinned count increased by 2 after pinning 2 memories', async () => {
    const { body } = await req('GET', '/api/stats');
    assert.strictEqual(body.pinned, basePinned + 2, `expected ${basePinned+2}, got ${body.pinned}`);
  });

  // 4. unpinning one reduces count by 1
  await test('unpinning a memory reduces pinned count by 1', async () => {
    await req('PUT', `/api/memories/${m1.id}`, { pinned: 0 });
    const { body } = await req('GET', '/api/stats');
    assert.strictEqual(body.pinned, basePinned + 1, `expected ${basePinned+1}, got ${body.pinned}`);
  });

  // 5. unpinning both returns to baseline
  await test('unpinning both returns to baseline count', async () => {
    await req('PUT', `/api/memories/${m2.id}`, { pinned: 0 });
    const { body } = await req('GET', '/api/stats');
    assert.strictEqual(body.pinned, basePinned, `expected ${basePinned}, got ${body.pinned}`);
  });

  // 6. memories count is still correct
  await test('memories count still correct alongside pinned', async () => {
    const { body } = await req('GET', '/api/stats');
    assert.ok(body.memories >= 3, `expected memories>=3, got ${body.memories}`);
  });

  const html = (await req('GET', '/')).body;

  // 7. HTML has pinned-badge element
  await test('HTML has #pinned-badge element', async () => {
    assert.ok(html.includes('id="pinned-badge"'), 'expected pinned-badge span');
  });

  // 8. refreshStats function updates pinned-badge
  await test('refreshStats updates pinned-badge', async () => {
    assert.ok(html.includes('pinned-badge'), 'pinned-badge referenced in refreshStats');
    assert.ok(html.includes("d.pinned"), 'refreshStats uses d.pinned');
  });

  // 9. badge is hidden when count is 0 (style logic present)
  await test('badge hides when pinned=0 (style logic present)', async () => {
    assert.ok(html.includes("b.style.display='none'"), 'expected hide logic for pinned-badge');
  });

  // 10. badge shows when pinned>0 (style logic present)
  await test('badge shows when pinned>0 (style logic present)', async () => {
    assert.ok(html.includes("b.style.display='inline'"), 'expected show logic for pinned-badge');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
