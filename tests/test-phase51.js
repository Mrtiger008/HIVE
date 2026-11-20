'use strict';
const assert = require('assert');
const path   = require('path');
const http   = require('http');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p51-${Date.now()}.db`);

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

async function seed(n) {
  for (let i = 0; i < n; i++) {
    await req('POST', '/api/memories', {
      title: `P51 Memory ${String(i).padStart(3,'0')}`,
      content: `Content for memory ${i}`,
      memory_type: 'semantic',
    });
  }
}

async function run() {
  let passed = 0;
  const total = 10;
  async function test(name, fn) {
    try { await fn(); console.log(`  ✓ ${name}`); passed++; }
    catch (e) { console.log(`  ✗ ${name}: ${e.message}`); }
  }

  console.log('\nPhase 51 — Pagination\n');

  // Seed 120 memories so we can test multi-page behaviour
  await seed(120);

  // 1. default page returns 50 results
  await test('default page returns 50 results', async () => {
    const r = await req('GET', '/api/memories');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.length, 50, `expected 50, got ${r.body.length}`);
  });

  // 2. ?limit= respected
  await test('?limit=10 returns 10 results', async () => {
    const r = await req('GET', '/api/memories?limit=10');
    assert.strictEqual(r.body.length, 10);
  });

  // 3. offset=0 and offset=50 return different sets
  await test('offset=0 and offset=50 return different memories', async () => {
    const p1 = await req('GET', '/api/memories?limit=50&offset=0');
    const p2 = await req('GET', '/api/memories?limit=50&offset=50');
    const ids1 = new Set(p1.body.map(m => m.id));
    const ids2 = new Set(p2.body.map(m => m.id));
    const overlap = [...ids1].filter(id => ids2.has(id));
    assert.strictEqual(overlap.length, 0, `pages overlap on ${overlap.length} id(s)`);
  });

  // 4. page 1 + page 2 together = 100 unique memories
  await test('page 1 + page 2 together have 100 unique memories', async () => {
    const p1 = await req('GET', '/api/memories?limit=50&offset=0');
    const p2 = await req('GET', '/api/memories?limit=50&offset=50');
    const ids = new Set([...p1.body.map(m=>m.id), ...p2.body.map(m=>m.id)]);
    assert.strictEqual(ids.size, 100);
  });

  // 5. offset beyond total returns empty array
  await test('offset beyond total returns empty array', async () => {
    const r = await req('GET', '/api/memories?limit=50&offset=99999');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.length, 0);
  });

  // 6. last page returns fewer than limit
  await test('last page returns fewer than page size', async () => {
    // Get total count, compute offset for last (partial) page
    const stats = await req('GET', '/api/stats');
    const total = stats.body.memories;
    const lastOffset = Math.floor(total / 50) * 50;
    const r = await req('GET', `/api/memories?limit=50&offset=${lastOffset}`);
    const expected = total % 50;
    if (expected === 0) {
      // divisible — last page is exactly 50 or empty; either is correct
      assert.ok(r.body.length <= 50, `expected <=50, got ${r.body.length}`);
    } else {
      assert.strictEqual(r.body.length, expected,
        `expected ${expected} at offset ${lastOffset}, got ${r.body.length}`);
    }
  });

  // 7. pages are non-overlapping and ordered consistently
  await test('pages are non-overlapping across 3 pages', async () => {
    const p1 = await req('GET', '/api/memories?limit=50&offset=0');
    const p2 = await req('GET', '/api/memories?limit=50&offset=50');
    const p3 = await req('GET', '/api/memories?limit=50&offset=100');
    const all = [...p1.body, ...p2.body, ...p3.body].map(m=>m.id);
    const unique = new Set(all);
    assert.strictEqual(unique.size, all.length, `duplicate ids across pages`);
  });

  // 8. pagination works with type filter
  await test('pagination works with type filter', async () => {
    const p1 = await req('GET', '/api/memories?limit=10&offset=0&type=semantic');
    const p2 = await req('GET', '/api/memories?limit=10&offset=10&type=semantic');
    assert.ok(p1.body.every(m => m.memory_type === 'semantic'));
    assert.ok(p2.body.every(m => m.memory_type === 'semantic'));
    const ids1 = new Set(p1.body.map(m=>m.id));
    const ids2 = new Set(p2.body.map(m=>m.id));
    assert.strictEqual([...ids1].filter(id => ids2.has(id)).length, 0);
  });

  // 9. offset=0 with limit=1 returns exactly 1 result
  await test('limit=1 offset=0 returns exactly 1 result', async () => {
    const r = await req('GET', '/api/memories?limit=1&offset=0');
    assert.strictEqual(r.body.length, 1);
  });

  // 10. each page result is a valid memory object
  await test('page results are valid memory objects', async () => {
    const r = await req('GET', '/api/memories?limit=20&offset=0');
    for (const m of r.body) {
      assert.ok(m.id,           'missing id');
      assert.ok(m.title,        'missing title');
      assert.ok(m.memory_type,  'missing memory_type');
      assert.ok(Array.isArray(m.tags), 'tags should be array');
    }
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
