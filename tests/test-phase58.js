'use strict';
const assert = require('assert');
const path   = require('path');
const http   = require('http');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p58-${Date.now()}.db`);

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

async function add(title, tags = [], content = 'some content') {
  const r = await req('POST', '/api/memories', { title, content, memory_type: 'semantic', tags });
  return r.body;
}

async function merge(keep, discard) {
  return req('POST', '/api/memories/merge', { keep, discard });
}

async function run() {
  let passed = 0;
  const total = 10;
  async function test(name, fn) {
    try { await fn(); console.log(`  ✓ ${name}`); passed++; }
    catch (e) { console.log(`  ✗ ${name}: ${e.message}`); }
  }

  console.log('\nPhase 58 — Memory Merge\n');

  const uid = `p58_${Date.now()}`;

  // 1. merge returns 200 and the kept memory
  await test('POST /api/memories/merge returns 200 with merged memory', async () => {
    const a = await add(`${uid} A`, ['x']);
    const b = await add(`${uid} B`, ['y']);
    const r = await merge(a.id, b.id);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.id, a.id, 'returned id should be the kept memory');
    assert.strictEqual(r.body.title, a.title, 'title should be from keep');
  });

  // 2. tags are unioned
  await test('merged memory has union of both tag sets', async () => {
    const a = await add(`${uid} TagA`, ['alpha', 'shared']);
    const b = await add(`${uid} TagB`, ['beta', 'shared']);
    const r = await merge(a.id, b.id);
    const tags = r.body.tags;
    assert.ok(tags.includes('alpha'), 'alpha missing');
    assert.ok(tags.includes('beta'),  'beta missing');
    assert.ok(tags.includes('shared'), 'shared missing');
    assert.strictEqual(tags.filter(t => t === 'shared').length, 1, 'shared duplicated');
  });

  // 3. discarded memory is archived, not deleted
  await test('discarded memory is archived (not deleted)', async () => {
    const a = await add(`${uid} KeepC`);
    const b = await add(`${uid} DiscardC`);
    await merge(a.id, b.id);
    const r = await req('GET', `/api/memories/${b.id}`);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.status, 'archived', 'discard should be archived');
  });

  // 4. kept memory title is preserved
  await test('kept memory title is preserved after merge', async () => {
    const a = await add(`${uid} KeepTitle`, ['t1']);
    const b = await add(`${uid} DiscardTitle`, ['t2']);
    const r = await merge(a.id, b.id);
    assert.strictEqual(r.body.title, a.title, 'keep title should not change');
  });

  // 5. returns 400 when keep === discard
  await test('returns 400 when keep and discard are the same id', async () => {
    const a = await add(`${uid} SameId`);
    const r = await merge(a.id, a.id);
    assert.strictEqual(r.status, 400);
  });

  // 6. returns 400 when ids missing
  await test('returns 400 when keep or discard is missing', async () => {
    const r = await req('POST', '/api/memories/merge', { keep: 'abc' });
    assert.strictEqual(r.status, 400);
  });

  // 7. returns 404 for nonexistent memory
  await test('returns 404 when a memory id does not exist', async () => {
    const a = await add(`${uid} RealE`);
    const r = await merge(a.id, 'nonexistent-id-99999');
    assert.strictEqual(r.status, 404);
  });

  // 8. merged memory content comes from keep
  await test('merged memory content comes from keep', async () => {
    const a = await add(`${uid} ContentKeep`, [], 'unique-keep-content');
    const b = await add(`${uid} ContentDiscard`, [], 'unique-discard-content');
    const r = await merge(a.id, b.id);
    assert.ok(r.body.content.includes('unique-keep-content'), 'content should be from keep');
  });

  // 9. kept memory is still active after merge
  await test('kept memory remains active after merge', async () => {
    const a = await add(`${uid} ActiveG`);
    const b = await add(`${uid} ArchivedG`);
    const r = await merge(a.id, b.id);
    assert.strictEqual(r.body.status, 'active', 'kept memory should be active');
  });

  // 10. dashboard HTML has merge modal and merge functions
  await test('dashboard HTML has merge modal and JS functions', async () => {
    const r = await new Promise((resolve, reject) => {
      const o = http.request({ hostname:'127.0.0.1', port:7749, path:'/', method:'GET' }, res => {
        let raw = ''; res.on('data', c => raw += c); res.on('end', () => resolve(raw));
      });
      o.on('error', reject); o.end();
    });
    assert.ok(r.includes('merge-modal'),   'expected merge-modal in HTML');
    assert.ok(r.includes('showMerge'),     'expected showMerge function');
    assert.ok(r.includes('confirmMerge'),  'expected confirmMerge function');
    assert.ok(r.includes('swapMerge'),     'expected swapMerge function');
    assert.ok(r.includes('bulk-merge-btn'), 'expected bulk-merge-btn in HTML');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
