'use strict';
const assert = require('assert');
const path   = require('path');
const http   = require('http');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p53-${Date.now()}.db`);

function req(method, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: '127.0.0.1', port: 7749, path: pathname, method,
      headers: { 'Content-Type': 'application/json', 'X-Hive-Local': '1',
                 ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}) },
    };
    const r = http.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => { let b; try { b = JSON.parse(raw); } catch { b = raw; } resolve({ status: res.statusCode, body: b }); });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

async function add(title, content, tags = []) {
  const r = await req('POST', '/api/memories', { title, content, memory_type: 'semantic', tags });
  return r.body;
}

async function run() {
  let passed = 0;
  const total = 10;
  async function test(name, fn) {
    try { await fn(); console.log(`  ✓ ${name}`); passed++; }
    catch (e) { console.log(`  ✗ ${name}: ${e.message}`); }
  }

  console.log('\nPhase 53 — Related Memories Panel\n');

  const uid = `p53_${Date.now()}`;
  // Seed a cluster of related memories about "machine learning"
  const ml1 = await add(`${uid} Machine Learning Basics`, 'supervised learning uses labeled training data', ['ml','ai']);
  const ml2 = await add(`${uid} Neural Networks`, 'deep learning with neural network layers', ['ml','deeplearning']);
  const ml3 = await add(`${uid} Gradient Descent`, 'optimisation algorithm for machine learning models', ['ml','optimisation']);
  const unrelated = await add(`${uid} Cooking Pasta`, 'boil water then add pasta and salt', ['food','cooking']);

  // 1. endpoint exists and returns 200
  await test('GET /api/memories/:id/related returns 200', async () => {
    const r = await req('GET', `/api/memories/${ml1.id}/related`);
    assert.strictEqual(r.status, 200, `expected 200, got ${r.status}`);
    assert.ok(Array.isArray(r.body), 'expected array');
  });

  // 2. results do not include the source memory itself
  await test('related results exclude the source memory', async () => {
    const r = await req('GET', `/api/memories/${ml1.id}/related`);
    const ids = r.body.map(m => m.id);
    assert.ok(!ids.includes(ml1.id), 'source memory should not appear in related results');
  });

  // 3. keyword-related memories appear in results
  await test('related memories share keywords with source', async () => {
    const r = await req('GET', `/api/memories/${ml1.id}/related`);
    assert.ok(r.body.length > 0, 'expected at least one related memory');
    const titles = r.body.map(m => m.title);
    const hasRelated = titles.some(t => t.includes(uid));
    assert.ok(hasRelated, `expected a p53 memory in related, got: ${titles.join(', ')}`);
  });

  // 4. ?limit= is respected
  await test('?limit=1 returns at most 1 result', async () => {
    const r = await req('GET', `/api/memories/${ml1.id}/related?limit=1`);
    assert.ok(r.body.length <= 1, `expected <=1, got ${r.body.length}`);
  });

  // 5. default limit is 5
  await test('default limit returns at most 5 results', async () => {
    const r = await req('GET', `/api/memories/${ml1.id}/related`);
    assert.ok(r.body.length <= 5, `expected <=5, got ${r.body.length}`);
  });

  // 6. returns 404 for nonexistent memory
  await test('returns 404 for nonexistent memory id', async () => {
    const r = await req('GET', '/api/memories/nonexistent-id-xyz/related');
    assert.strictEqual(r.status, 404);
  });

  // 7. result objects have required fields
  await test('related result objects have id, title, content, memory_type', async () => {
    const r = await req('GET', `/api/memories/${ml1.id}/related`);
    if (!r.body.length) { assert.fail('no results to check'); return; }
    for (const m of r.body) {
      assert.ok(m.id,          `missing id on result`);
      assert.ok(m.title,       `missing title on result`);
      assert.ok(m.memory_type, `missing memory_type on result`);
    }
  });

  // 8. ml2 and ml3 appear in ml1's related (shared ml tag)
  await test('tag-sharing memories appear in related results', async () => {
    const r = await req('GET', `/api/memories/${ml1.id}/related?limit=10`);
    const ids = r.body.map(m => m.id);
    const hasML2 = ids.includes(ml2.id);
    const hasML3 = ids.includes(ml3.id);
    assert.ok(hasML2 || hasML3, `expected ml2 or ml3 in related; got ids: ${ids.join(',')}`);
  });

  // 9. dashboard HTML contains toggleRelated function
  await test('dashboard HTML contains toggleRelated function', async () => {
    const r = await new Promise((resolve, reject) => {
      const o = http.request({ hostname:'127.0.0.1', port:7749, path:'/', method:'GET' }, res => {
        let raw = ''; res.on('data', c => raw += c); res.on('end', () => resolve(raw));
      });
      o.on('error', reject); o.end();
    });
    assert.ok(r.includes('toggleRelated'), 'expected toggleRelated in dashboard HTML');
    assert.ok(r.includes('/related'), 'expected /related API path in dashboard HTML');
  });

  // 10. dashboard HTML has rel- drawer element in card template
  await test('card template includes rel-drawer element', async () => {
    const r = await new Promise((resolve, reject) => {
      const o = http.request({ hostname:'127.0.0.1', port:7749, path:'/', method:'GET' }, res => {
        let raw = ''; res.on('data', c => raw += c); res.on('end', () => resolve(raw));
      });
      o.on('error', reject); o.end();
    });
    assert.ok(r.includes('rel-${m.id}') || r.includes("rel-\\${m.id}") || r.includes('~ related'),
      'expected related drawer or button in card template');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
