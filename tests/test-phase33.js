'use strict';
const assert = require('assert');
const path = require('path');
const http = require('http');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p33-${Date.now()}.db`);

const memory = require('../src/memory');

function req(method, pathname, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: '127.0.0.1', port: 7749,
      path: pathname, method,
      headers: {
        'Content-Type': 'application/json',
        'X-Hive-Local': '1',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };
    const r = http.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        let body = null;
        try { body = raw ? JSON.parse(raw) : null; } catch { body = raw || null; }
        resolve({ status: res.statusCode, body });
      });
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
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (e) {
      console.log(`  ✗ ${name}: ${e.message}`);
    }
  }

  console.log('\nPhase 33 — Memory Pinning\n');

  // 1. New memories default unpinned
  await test('new memory defaults to pinned=0', async () => {
    const m = memory.add({ title: 'Unpinned default', content: 'Content', memory_type: 'semantic' });
    assert.strictEqual(m.pinned, 0);
  });

  // 2. Pin via memory.update
  await test('memory.update sets pinned=1', async () => {
    const m = memory.add({ title: 'To pin', content: 'Content', memory_type: 'semantic' });
    const updated = memory.update(m.id, { pinned: 1 });
    assert.strictEqual(updated.pinned, 1);
  });

  // 3. Unpin via memory.update
  await test('memory.update sets pinned=0', async () => {
    const m = memory.add({ title: 'Pin then unpin', content: 'Content', memory_type: 'semantic' });
    memory.update(m.id, { pinned: 1 });
    const updated = memory.update(m.id, { pinned: 0 });
    assert.strictEqual(updated.pinned, 0);
  });

  // 4. Pinned memories appear first in list
  await test('pinned memories sort before unpinned', async () => {
    // Add with low importance so order is driven by pinned flag
    const low = memory.add({ title: 'Low importance', content: 'C', memory_type: 'semantic', importance: 1 });
    const pinned = memory.add({ title: 'Pinned high', content: 'C', memory_type: 'semantic', importance: 1 });
    memory.update(pinned.id, { pinned: 1 });
    const list = memory.list({ limit: 50 });
    const pinnedIdx = list.findIndex(x => x.id === pinned.id);
    const lowIdx = list.findIndex(x => x.id === low.id);
    assert.ok(pinnedIdx < lowIdx, `pinned at ${pinnedIdx}, low at ${lowIdx}`);
  });

  // 5. POST /api/memories/:id/pin
  await test('API POST /pin sets pinned', async () => {
    const cr = await req('POST', '/api/memories', { title: 'API pin test', content: 'C', memory_type: 'semantic' });
    assert.strictEqual(cr.status, 201);
    const id = cr.body.id;
    const r = await req('POST', `/api/memories/${id}/pin`);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.pinned, 1);
  });

  // 6. POST /api/memories/:id/unpin
  await test('API POST /unpin clears pinned', async () => {
    const cr = await req('POST', '/api/memories', { title: 'API unpin test', content: 'C', memory_type: 'semantic' });
    const id = cr.body.id;
    await req('POST', `/api/memories/${id}/pin`);
    const r = await req('POST', `/api/memories/${id}/unpin`);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.pinned, 0);
  });

  // 7. GET /api/memories?pinned=1 returns only pinned
  await test('API GET /api/memories?pinned=1 filters correctly', async () => {
    const cr = await req('POST', '/api/memories', { title: 'Filtered pinned API', content: 'C', memory_type: 'semantic' });
    const id = cr.body.id;
    await req('POST', `/api/memories/${id}/pin`);
    const r = await req('GET', '/api/memories?pinned=1&limit=100');
    assert.strictEqual(r.status, 200);
    const ids = r.body.map(x => x.id);
    assert.ok(ids.includes(id), 'pinned memory not in filtered list');
    assert.ok(r.body.every(x => x.pinned === 1), 'non-pinned item in filtered list');
  });

  // 8. pin via PUT /api/memories/:id (the update endpoint)
  await test('PUT /api/memories/:id with pinned field works', async () => {
    const cr = await req('POST', '/api/memories', { title: 'PUT pin test', content: 'C', memory_type: 'semantic' });
    const id = cr.body.id;
    const r = await req('PUT', `/api/memories/${id}`, { pinned: true });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.pinned, 1);
  });

  // 9. Invalid memory id returns 404
  await test('POST /api/memories/nonexistent/pin returns 404', async () => {
    const r = await req('POST', '/api/memories/nonexistent-uuid/pin');
    assert.strictEqual(r.status, 404);
  });

  // 10. Multiple pinned memories retain order among themselves (by importance)
  await test('multiple pinned memories ordered by importance then updated_at', async () => {
    const a = memory.add({ title: 'Pinned low imp', content: 'C', memory_type: 'semantic', importance: 2 });
    const b = memory.add({ title: 'Pinned high imp', content: 'C', memory_type: 'semantic', importance: 9 });
    memory.update(a.id, { pinned: 1 });
    memory.update(b.id, { pinned: 1 });
    const list = memory.list({ limit: 50 });
    const pinnedList = list.filter(x => x.pinned === 1);
    const idxA = pinnedList.findIndex(x => x.id === a.id);
    const idxB = pinnedList.findIndex(x => x.id === b.id);
    assert.ok(idxB < idxA, `high-importance pinned (${idxB}) should come before low-importance (${idxA})`);
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
