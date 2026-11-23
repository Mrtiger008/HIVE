'use strict';
const assert = require('assert');
const http   = require('http');
const path   = require('path');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p102-${Date.now()}.db`);

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

  console.log('\nPhase 102 — Confidence Distribution\n');

  // Seed memories across confidence buckets
  // Bucket 0–20%:  2 memories (conf 0.1, 0.15)
  // Bucket 20–40%: 1 memory  (conf 0.3)
  // Bucket 60–80%: 2 memories (conf 0.65, 0.75)
  // Bucket 80–100%:1 memory  (conf 0.9)
  await req('POST', '/api/memories', { title: 'LowA',    content: 'low conf a',    memory_type: 'core',     confidence: 0.1  });
  await req('POST', '/api/memories', { title: 'LowB',    content: 'low conf b',    memory_type: 'core',     confidence: 0.15 });
  await req('POST', '/api/memories', { title: 'MidLow',  content: 'mid-low conf',  memory_type: 'core',     confidence: 0.3  });
  await req('POST', '/api/memories', { title: 'MidHighA',content: 'mid-high a',    memory_type: 'semantic', confidence: 0.65 });
  await req('POST', '/api/memories', { title: 'MidHighB',content: 'mid-high b',    memory_type: 'semantic', confidence: 0.75 });
  await req('POST', '/api/memories', { title: 'HighConf',content: 'high conf',     memory_type: 'core',     confidence: 0.9  });

  // 1. endpoint returns 200
  await test('GET /api/stats/confidence-dist returns 200', async () => {
    const { status } = await req('GET', '/api/stats/confidence-dist');
    assert.strictEqual(status, 200);
  });

  // 2. returns array of 5 buckets
  await test('response is array of 5 buckets', async () => {
    const { body } = await req('GET', '/api/stats/confidence-dist');
    assert.ok(Array.isArray(body), 'expected array');
    assert.strictEqual(body.length, 5, 'expected 5 buckets');
  });

  // 3. each bucket has label and count
  await test('each bucket has label and count fields', async () => {
    const { body } = await req('GET', '/api/stats/confidence-dist');
    for (const b of body) {
      assert.ok('label' in b, 'expected label field');
      assert.ok('count' in b, 'expected count field');
      assert.ok(typeof b.count === 'number', 'count should be number');
    }
  });

  // 4. bucket labels cover expected ranges
  await test('bucket labels match expected ranges', async () => {
    const { body } = await req('GET', '/api/stats/confidence-dist');
    const labels = body.map(b => b.label);
    assert.ok(labels.some(l => l.includes('0')),   'expected 0% bucket');
    assert.ok(labels.some(l => l.includes('80')),  'expected 80% bucket');
  });

  // 5. 0–20% bucket has count >= 2
  await test('0–20% bucket has count >= 2', async () => {
    const { body } = await req('GET', '/api/stats/confidence-dist');
    const bucket = body.find(b => b.label.startsWith('0'));
    assert.ok(bucket, '0–20% bucket should exist');
    assert.ok(bucket.count >= 2, `expected >= 2, got ${bucket.count}`);
  });

  // 6. 20–40% bucket has count >= 1
  await test('20–40% bucket has count >= 1', async () => {
    const { body } = await req('GET', '/api/stats/confidence-dist');
    const bucket = body.find(b => b.label.includes('20'));
    assert.ok(bucket, '20–40% bucket should exist');
    assert.ok(bucket.count >= 1, `expected >= 1, got ${bucket.count}`);
  });

  // 7. 80–100% bucket has count >= 1
  await test('80–100% bucket has count >= 1', async () => {
    const { body } = await req('GET', '/api/stats/confidence-dist');
    const bucket = body.find(b => b.label.includes('80'));
    assert.ok(bucket, '80–100% bucket should exist');
    assert.ok(bucket.count >= 1, `expected >= 1, got ${bucket.count}`);
  });

  // 8. all counts are non-negative
  await test('all bucket counts are non-negative', async () => {
    const { body } = await req('GET', '/api/stats/confidence-dist');
    for (const b of body) {
      assert.ok(b.count >= 0, `bucket ${b.label} has negative count ${b.count}`);
    }
  });

  const html = (await req('GET', '/')).body;

  // 9. HTML references confidence-dist endpoint
  await test('HTML fetches /api/stats/confidence-dist', async () => {
    assert.ok(html.includes('/api/stats/confidence-dist'), 'expected confidence-dist endpoint in HTML');
  });

  // 10. HTML has ks-conf-dist element
  await test('HTML has ks-conf-dist element', async () => {
    assert.ok(html.includes('ks-conf-dist'), 'expected ks-conf-dist div in HTML');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
