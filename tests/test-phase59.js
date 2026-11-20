'use strict';
const assert = require('assert');
const path   = require('path');
const http   = require('http');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p59-${Date.now()}.db`);

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

async function add(title, tags = []) {
  return (await req('POST', '/api/memories', { title, content: 'content', memory_type: 'semantic', tags })).body;
}

async function run() {
  let passed = 0;
  const total = 10;
  async function test(name, fn) {
    try { await fn(); console.log(`  ✓ ${name}`); passed++; }
    catch (e) { console.log(`  ✗ ${name}: ${e.message}`); }
  }

  console.log('\nPhase 59 — Quick Tag Filter\n');

  const uid = `p59_${Date.now()}`;
  await add(`${uid} Alpha`, ['alpha-tag', 'shared-tag']);
  await add(`${uid} Beta`,  ['beta-tag',  'shared-tag']);
  await add(`${uid} Gamma`, ['gamma-tag']);

  // 1. /api/memories?tag= filters by tag
  await test('GET /api/memories?tag= returns only memories with that tag', async () => {
    const r = await req('GET', '/api/memories?tag=alpha-tag');
    assert.strictEqual(r.status, 200);
    const titles = r.body.map(m => m.title);
    assert.ok(titles.some(t => t.includes('Alpha')), 'Alpha should be in results');
    assert.ok(!titles.some(t => t.includes('Beta')),  'Beta should not be in results (no alpha-tag)');
  });

  // 2. tag filter with shared tag returns multiple
  await test('tag filter with shared tag returns all matching memories', async () => {
    const r = await req('GET', '/api/memories?tag=shared-tag');
    assert.strictEqual(r.status, 200);
    const titles = r.body.map(m => m.title).filter(t => t.startsWith(uid));
    assert.ok(titles.length >= 2, 'both Alpha and Beta should match shared-tag');
  });

  // 3. tag filter with no matches returns empty array
  await test('tag filter with no matches returns empty array', async () => {
    const r = await req('GET', '/api/memories?tag=no-such-tag-' + Date.now());
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.body), 'expected array');
    assert.strictEqual(r.body.length, 0);
  });

  // 4. no tag filter returns all memories
  await test('no tag param returns all active memories', async () => {
    const r = await req('GET', '/api/memories?limit=1000');
    assert.strictEqual(r.status, 200);
    const titles = r.body.map(m => m.title).filter(t => t.startsWith(uid));
    assert.ok(titles.length >= 3, 'all 3 test memories should appear without tag filter');
  });

  // 5. tag filter combined with type filter
  await test('tag filter works alongside type filter', async () => {
    const r = await req('GET', '/api/memories?tag=alpha-tag&type=semantic');
    assert.strictEqual(r.status, 200);
    const hit = r.body.find(m => m.title.includes('Alpha'));
    assert.ok(hit, 'Alpha should match both filters');
    assert.strictEqual(hit.memory_type, 'semantic');
  });

  // 6. dashboard HTML has filterTag function
  await test('dashboard HTML has filterTag function', async () => {
    const r = await new Promise((resolve, reject) => {
      const o = http.request({ hostname:'127.0.0.1', port:7749, path:'/', method:'GET' }, res => {
        let raw = ''; res.on('data', c => raw += c); res.on('end', () => resolve(raw));
      });
      o.on('error', reject); o.end();
    });
    assert.ok(r.includes('filterTag'), 'expected filterTag in HTML');
  });

  // 7. dashboard HTML filterTag has toggle-off logic
  await test('filterTag has toggle-off (clear) logic', async () => {
    const r = await new Promise((resolve, reject) => {
      const o = http.request({ hostname:'127.0.0.1', port:7749, path:'/', method:'GET' }, res => {
        let raw = ''; res.on('data', c => raw += c); res.on('end', () => resolve(raw));
      });
      o.on('error', reject); o.end();
    });
    assert.ok(r.includes('sel.value === tag'), 'expected toggle-off check in filterTag');
  });

  // 8. dashboard card HTML uses _activeTg for active-tag highlighting
  await test('card() reads _activeTg for active tag highlighting', async () => {
    const r = await new Promise((resolve, reject) => {
      const o = http.request({ hostname:'127.0.0.1', port:7749, path:'/', method:'GET' }, res => {
        let raw = ''; res.on('data', c => raw += c); res.on('end', () => resolve(raw));
      });
      o.on('error', reject); o.end();
    });
    assert.ok(r.includes('_activeTg'), 'expected _activeTg variable in card()');
  });

  // 9. tag chips have title attribute for discoverability
  await test('tag chips have title="Filter by" attribute', async () => {
    const r = await new Promise((resolve, reject) => {
      const o = http.request({ hostname:'127.0.0.1', port:7749, path:'/', method:'GET' }, res => {
        let raw = ''; res.on('data', c => raw += c); res.on('end', () => resolve(raw));
      });
      o.on('error', reject); o.end();
    });
    assert.ok(r.includes('Filter by'), 'expected "Filter by" title on tag chips');
  });

  // 10. filterTag ensures option exists before setting select value
  await test('filterTag adds option if not in select (robustness check in HTML)', async () => {
    const r = await new Promise((resolve, reject) => {
      const o = http.request({ hostname:'127.0.0.1', port:7749, path:'/', method:'GET' }, res => {
        let raw = ''; res.on('data', c => raw += c); res.on('end', () => resolve(raw));
      });
      o.on('error', reject); o.end();
    });
    assert.ok(r.includes('sel.options'), 'expected option-existence check in filterTag');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
