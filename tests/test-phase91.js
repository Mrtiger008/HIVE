'use strict';
const assert = require('assert');
const http   = require('http');
const path   = require('path');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p91-${Date.now()}.db`);

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

  console.log('\nPhase 91 — Expired Memories Filter\n');

  const now = Date.now();
  const past   = now - 7 * 86400000;
  const soon   = now + 3 * 86400000;
  const future = now + 30 * 86400000;

  // Seed: 1 expired, 1 expiring soon, 1 future, 1 no expiry
  const { body: m1 } = await req('POST', '/api/memories', { title: 'Expired mem', content: 'x', memory_type: 'core', expires_at: past });
  const { body: m2 } = await req('POST', '/api/memories', { title: 'Soon mem',    content: 'x', memory_type: 'core', expires_at: soon });
  const { body: m3 } = await req('POST', '/api/memories', { title: 'Future mem',  content: 'x', memory_type: 'core', expires_at: future });
  const { body: m4 } = await req('POST', '/api/memories', { title: 'No expiry',   content: 'x', memory_type: 'core' });

  // 1. expires=expired returns only past-expired memories
  await test('expires=expired returns expired memories', async () => {
    const { body } = await req('GET', '/api/memories?expires=expired&limit=1000');
    assert.ok(body.some(m => m.id === m1.id), 'should include expired memory');
    assert.ok(!body.some(m => m.id === m4.id), 'should not include no-expiry memory');
  });

  // 2. expires=expired excludes future memories
  await test('expires=expired excludes future-expiry memories', async () => {
    const { body } = await req('GET', '/api/memories?expires=expired&limit=1000');
    assert.ok(!body.some(m => m.id === m3.id), 'should not include future memory');
  });

  // 3. expires=soon returns expiring-within-7d memories
  await test('expires=soon returns expiring-soon memories', async () => {
    const { body } = await req('GET', '/api/memories?expires=soon&limit=1000');
    assert.ok(body.some(m => m.id === m2.id), 'should include soon memory');
  });

  // 4. expires=soon excludes already-expired memories
  await test('expires=soon excludes already-expired memories', async () => {
    const { body } = await req('GET', '/api/memories?expires=soon&limit=1000');
    assert.ok(!body.some(m => m.id === m1.id), 'should not include already-expired memory');
  });

  // 5. expires=any returns all memories that have an expiry date
  await test('expires=any returns all memories with expiry set', async () => {
    const { body } = await req('GET', '/api/memories?expires=any&limit=1000');
    assert.ok(body.some(m => m.id === m1.id), 'should include expired');
    assert.ok(body.some(m => m.id === m2.id), 'should include soon');
    assert.ok(body.some(m => m.id === m3.id), 'should include future');
  });

  // 6. expires=any excludes memories with no expiry
  await test('expires=any excludes no-expiry memories', async () => {
    const { body } = await req('GET', '/api/memories?expires=any&limit=1000');
    assert.ok(!body.some(m => m.id === m4.id), 'should not include no-expiry memory');
  });

  // 7. No expires param returns all (including no-expiry)
  await test('no expires param returns all memories', async () => {
    const { body } = await req('GET', '/api/memories?limit=1000');
    assert.ok(body.some(m => m.id === m4.id), 'should include no-expiry memory');
  });

  const html = (await req('GET', '/')).body;

  // 8. HTML has mexp select
  await test('HTML has #mexp select', async () => {
    assert.ok(html.includes('id="mexp"'), 'expected #mexp in HTML');
  });

  // 9. HTML has expired option in mexp
  await test('HTML mexp has expired option', async () => {
    assert.ok(html.includes('value="expired"'), 'expected expired option');
  });

  // 10. clearAllMemFilters resets mexp
  await test('clearAllMemFilters includes mexp', async () => {
    assert.ok(html.includes("'mexp'"), 'expected mexp in clearAllMemFilters list');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
