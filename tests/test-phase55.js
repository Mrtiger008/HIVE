'use strict';
const assert = require('assert');
const path   = require('path');
const http   = require('http');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p55-${Date.now()}.db`);

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
  const r = await req('POST', '/api/memories', { title, content: 'content for ' + title, memory_type: 'semantic', tags });
  return r.body;
}

async function bulk(ids, action, tags) {
  return req('POST', '/api/memories/bulk', { ids, action, updates: { tags } });
}

async function run() {
  let passed = 0;
  const total = 10;
  async function test(name, fn) {
    try { await fn(); console.log(`  ✓ ${name}`); passed++; }
    catch (e) { console.log(`  ✗ ${name}: ${e.message}`); }
  }

  console.log('\nPhase 55 — Bulk Tag Editor\n');

  const uid = `p55_${Date.now()}`;
  const m1 = await add(`${uid} A`, ['alpha', 'beta']);
  const m2 = await add(`${uid} B`, ['beta', 'gamma']);
  const m3 = await add(`${uid} C`, []);

  // 1. add_tags adds to existing tags without duplicates
  await test('add_tags merges tags without duplicates', async () => {
    const r = await bulk([m1.id], 'add_tags', ['delta', 'alpha']); // alpha already exists
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.count, 1);
    const updated = await req('GET', `/api/memories/${m1.id}`);
    const tags = updated.body.tags;
    assert.ok(tags.includes('alpha'), 'alpha should still be present');
    assert.ok(tags.includes('beta'),  'beta should still be present');
    assert.ok(tags.includes('delta'), 'delta should be added');
    assert.strictEqual(tags.filter(t => t === 'alpha').length, 1, 'alpha should not be duplicated');
  });

  // 2. add_tags works across multiple memories
  await test('add_tags applies to all selected memories', async () => {
    await bulk([m2.id, m3.id], 'add_tags', ['shared']);
    const r2 = await req('GET', `/api/memories/${m2.id}`);
    const r3 = await req('GET', `/api/memories/${m3.id}`);
    assert.ok(r2.body.tags.includes('shared'), 'm2 should have shared tag');
    assert.ok(r3.body.tags.includes('shared'), 'm3 should have shared tag');
  });

  // 3. remove_tags removes specified tags
  await test('remove_tags removes specified tags', async () => {
    await bulk([m1.id], 'remove_tags', ['beta']);
    const updated = await req('GET', `/api/memories/${m1.id}`);
    assert.ok(!updated.body.tags.includes('beta'), 'beta should be removed');
    assert.ok(updated.body.tags.includes('alpha'),  'alpha should still be present');
  });

  // 4. remove_tags ignores tags that don't exist
  await test('remove_tags on absent tag does not error', async () => {
    const r = await bulk([m3.id], 'remove_tags', ['nonexistent']);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.count, 1);
  });

  // 5. remove_tags works across multiple memories
  await test('remove_tags removes tag from all selected', async () => {
    await bulk([m2.id, m3.id], 'remove_tags', ['shared']);
    const r2 = await req('GET', `/api/memories/${m2.id}`);
    const r3 = await req('GET', `/api/memories/${m3.id}`);
    assert.ok(!r2.body.tags.includes('shared'), 'm2 shared should be removed');
    assert.ok(!r3.body.tags.includes('shared'), 'm3 shared should be removed');
  });

  // 6. add_tags on memory with no tags sets tags cleanly
  await test('add_tags on memory with empty tags sets them correctly', async () => {
    const fresh = await add(`${uid} D`, []);
    await bulk([fresh.id], 'add_tags', ['newbie']);
    const updated = await req('GET', `/api/memories/${fresh.id}`);
    assert.deepStrictEqual(updated.body.tags, ['newbie']);
  });

  // 7. bulk returns count of affected memories
  await test('bulk returns correct affected count', async () => {
    const a = await add(`${uid} E`, []);
    const b = await add(`${uid} F`, []);
    const r = await bulk([a.id, b.id], 'add_tags', ['counted']);
    assert.strictEqual(r.body.count, 2);
  });

  // 8. bulk with empty ids returns 400
  await test('bulk with empty ids array returns 400', async () => {
    const r = await req('POST', '/api/memories/bulk', { ids: [], action: 'add_tags', updates: { tags: ['x'] } });
    assert.strictEqual(r.status, 400);
  });

  // 9. dashboard HTML has bulk-tags input
  await test('dashboard HTML has bulk-tags input', async () => {
    const r = await new Promise((resolve, reject) => {
      const o = http.request({ hostname:'127.0.0.1', port:7749, path:'/', method:'GET' }, res => {
        let raw = ''; res.on('data', c => raw += c); res.on('end', () => resolve(raw));
      });
      o.on('error', reject); o.end();
    });
    assert.ok(r.includes('bulk-tags'), 'expected bulk-tags input in HTML');
    assert.ok(r.includes('bulkTagOp'), 'expected bulkTagOp function in HTML');
  });

  // 10. add_tags then remove_tags round-trip leaves original tags intact
  await test('add then remove round-trip restores original tag set', async () => {
    const orig = await add(`${uid} G`, ['x', 'y']);
    await bulk([orig.id], 'add_tags', ['z']);
    await bulk([orig.id], 'remove_tags', ['z']);
    const updated = await req('GET', `/api/memories/${orig.id}`);
    assert.ok(updated.body.tags.includes('x'), 'x should remain');
    assert.ok(updated.body.tags.includes('y'), 'y should remain');
    assert.ok(!updated.body.tags.includes('z'), 'z should be gone');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
