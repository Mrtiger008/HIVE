'use strict';
const assert = require('assert');
const http   = require('http');
const path   = require('path');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p107-${Date.now()}.db`);

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

  console.log('\nPhase 107 — Stale Memories Filter\n');

  // Seed a fresh memory (updated_at = now — not stale for any threshold)
  const { body: fresh } = await req('POST', '/api/memories', { title: 'FreshMem', content: 'recently updated content', memory_type: 'core' });

  // 1. stale=7d returns 200
  await test('stale=7d returns 200', async () => {
    const { status } = await req('GET', '/api/memories?stale=7d&limit=100');
    assert.strictEqual(status, 200);
  });

  // 2. stale=7d returns array
  await test('stale=7d returns array', async () => {
    const { body } = await req('GET', '/api/memories?stale=7d&limit=100');
    assert.ok(Array.isArray(body));
  });

  // 3. fresh memory NOT in stale=7d
  await test('just-created memory absent from stale=7d', async () => {
    const { body } = await req('GET', '/api/memories?stale=7d&limit=1000');
    assert.ok(!body.some(m => m.id === fresh.id), 'just-created memory should not be stale');
  });

  // 4. fresh memory NOT in stale=30d
  await test('just-created memory absent from stale=30d', async () => {
    const { body } = await req('GET', '/api/memories?stale=30d&limit=1000');
    assert.ok(!body.some(m => m.id === fresh.id));
  });

  // 5. fresh memory NOT in stale=60d
  await test('just-created memory absent from stale=60d', async () => {
    const { body } = await req('GET', '/api/memories?stale=60d&limit=1000');
    assert.ok(!body.some(m => m.id === fresh.id));
  });

  // 6. fresh memory NOT in stale=90d
  await test('just-created memory absent from stale=90d', async () => {
    const { body } = await req('GET', '/api/memories?stale=90d&limit=1000');
    assert.ok(!body.some(m => m.id === fresh.id));
  });

  // 7. all results in stale=30d have updated_at older than 30 days
  await test('all stale=30d results have updated_at older than 30d', async () => {
    const cutoff = Date.now() - 30 * 86400000;
    const { body } = await req('GET', '/api/memories?stale=30d&limit=1000');
    for (const m of body) {
      assert.ok(m.updated_at < cutoff, `memory ${m.id} updated_at ${m.updated_at} should be < cutoff ${cutoff}`);
    }
  });

  // 8. stale can combine with type filter
  await test('stale filter combines with type filter', async () => {
    const { body } = await req('GET', '/api/memories?stale=7d&type=core&limit=1000');
    assert.ok(Array.isArray(body));
    for (const m of body) {
      assert.strictEqual(m.memory_type, 'core');
    }
  });

  const html = (await req('GET', '/')).body;

  // 9. HTML has mstale select element
  await test('HTML has mstale select', async () => {
    assert.ok(html.includes('mstale'), 'expected mstale select in HTML');
  });

  // 10. HTML passes stale param to API
  await test('HTML wires mstale to stale param', async () => {
    assert.ok(html.includes('stale='), 'expected stale= in HTML query builder');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
