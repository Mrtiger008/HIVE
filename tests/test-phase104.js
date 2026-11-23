'use strict';
const assert = require('assert');
const http   = require('http');
const path   = require('path');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p104-${Date.now()}.db`);

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

  console.log('\nPhase 104 — Importance Distribution\n');

  // Seed memories across importance buckets
  // 1–2: 2 memories  (imp 1, 2)
  // 3–4: 1 memory    (imp 3)
  // 7–8: 2 memories  (imp 7, 8)
  // 9–10: 1 memory   (imp 10)
  await req('POST', '/api/memories', { title: 'ImpA', content: 'imp a content here', memory_type: 'core',     importance: 1  });
  await req('POST', '/api/memories', { title: 'ImpB', content: 'imp b content here', memory_type: 'core',     importance: 2  });
  await req('POST', '/api/memories', { title: 'ImpC', content: 'imp c content here', memory_type: 'semantic', importance: 3  });
  await req('POST', '/api/memories', { title: 'ImpD', content: 'imp d content here', memory_type: 'semantic', importance: 7  });
  await req('POST', '/api/memories', { title: 'ImpE', content: 'imp e content here', memory_type: 'core',     importance: 8  });
  await req('POST', '/api/memories', { title: 'ImpF', content: 'imp f content here', memory_type: 'core',     importance: 10 });

  // 1. endpoint returns 200
  await test('GET /api/stats/importance-dist returns 200', async () => {
    const { status } = await req('GET', '/api/stats/importance-dist');
    assert.strictEqual(status, 200);
  });

  // 2. returns array of 5 buckets
  await test('response is array of 5 buckets', async () => {
    const { body } = await req('GET', '/api/stats/importance-dist');
    assert.ok(Array.isArray(body), 'expected array');
    assert.strictEqual(body.length, 5, 'expected 5 buckets');
  });

  // 3. each bucket has label and count
  await test('each bucket has label and count fields', async () => {
    const { body } = await req('GET', '/api/stats/importance-dist');
    for (const b of body) {
      assert.ok('label' in b, 'expected label field');
      assert.ok('count' in b, 'expected count field');
      assert.ok(typeof b.count === 'number', 'count should be number');
    }
  });

  // 4. bucket labels cover expected ranges
  await test('bucket labels include 1-2 and 9-10 ranges', async () => {
    const { body } = await req('GET', '/api/stats/importance-dist');
    const labels = body.map(b => b.label);
    assert.ok(labels.some(l => l.includes('1')), 'expected low importance bucket');
    assert.ok(labels.some(l => l.includes('9') || l.includes('10')), 'expected high importance bucket');
  });

  // 5. 1–2 bucket has count >= 2
  await test('1–2 bucket has count >= 2', async () => {
    const { body } = await req('GET', '/api/stats/importance-dist');
    const bucket = body.find(b => b.label.startsWith('1'));
    assert.ok(bucket, '1–2 bucket should exist');
    assert.ok(bucket.count >= 2, `expected >= 2, got ${bucket.count}`);
  });

  // 6. 9–10 bucket has count >= 1
  await test('9–10 bucket has count >= 1', async () => {
    const { body } = await req('GET', '/api/stats/importance-dist');
    const bucket = body.find(b => b.label.includes('9'));
    assert.ok(bucket, '9–10 bucket should exist');
    assert.ok(bucket.count >= 1, `expected >= 1, got ${bucket.count}`);
  });

  // 7. all counts are non-negative
  await test('all bucket counts are non-negative', async () => {
    const { body } = await req('GET', '/api/stats/importance-dist');
    for (const b of body) {
      assert.ok(b.count >= 0, `bucket ${b.label} has negative count ${b.count}`);
    }
  });

  // 8. sum of all buckets >= total active memories seeded
  await test('sum of bucket counts >= seeded memory count', async () => {
    const { body } = await req('GET', '/api/stats/importance-dist');
    const total = body.reduce((s, b) => s + b.count, 0);
    assert.ok(total >= 6, `expected total >= 6, got ${total}`);
  });

  const html = (await req('GET', '/')).body;

  // 9. HTML references importance-dist endpoint
  await test('HTML fetches /api/stats/importance-dist', async () => {
    assert.ok(html.includes('/api/stats/importance-dist'), 'expected importance-dist endpoint in HTML');
  });

  // 10. HTML has ks-imp-dist element
  await test('HTML has ks-imp-dist element', async () => {
    assert.ok(html.includes('ks-imp-dist'), 'expected ks-imp-dist div in HTML');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
