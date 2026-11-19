'use strict';
const assert = require('assert');
const path   = require('path');
const http   = require('http');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p37-${Date.now()}.db`);

const memory    = require('../src/memory');
const conflicts = require('../src/conflicts');

function req(method, pathname, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = { hostname: '127.0.0.1', port: 7749, path: pathname, method,
      headers: { 'Content-Type': 'application/json', 'X-Hive-Local': '1',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } };
    const r = http.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        let b = null; try { b = raw ? JSON.parse(raw) : null; } catch { b = raw; }
        resolve({ status: res.statusCode, body: b });
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
    try { await fn(); console.log(`  ✓ ${name}`); passed++; }
    catch (e) { console.log(`  ✗ ${name}: ${e.message}`); }
  }

  console.log('\nPhase 37 — Conflict Resolution\n');

  // 1. detect() returns expected structure
  await test('detect() returns {conflicted, contradictLinks, superseded}', async () => {
    const d = conflicts.detect();
    assert.ok(Array.isArray(d.conflicted));
    assert.ok(Array.isArray(d.contradictLinks));
    assert.ok(Array.isArray(d.superseded));
  });

  // 2. CONFLICTED trust_level memory appears in conflicted list
  await test('memory with trust_level CONFLICTED appears in detect().conflicted', async () => {
    const m = memory.add({ title: 'Conflicted mem', content: 'C', memory_type: 'semantic', trust_level: 'CONFLICTED' });
    const d = conflicts.detect();
    assert.ok(d.conflicted.some(x => x.id === m.id));
  });

  // 3. markConflict() creates a 'contradicts' link
  await test('markConflict() creates contradicts link in DB', async () => {
    const a = memory.add({ title: 'Conflict A', content: 'C', memory_type: 'semantic' });
    const b = memory.add({ title: 'Conflict B', content: 'C', memory_type: 'semantic' });
    const link = conflicts.markConflict(a.id, b.id, 'different sources');
    assert.ok(link.id, 'expected link id');
    assert.strictEqual(link.rel_type, 'contradicts');
  });

  // 4. After markConflict, both memories have trust_level CONFLICTED
  await test('markConflict() sets both memories to CONFLICTED trust level', async () => {
    const a = memory.add({ title: 'Mark A', content: 'C', memory_type: 'semantic', trust_level: 'OBSERVED' });
    const b = memory.add({ title: 'Mark B', content: 'C', memory_type: 'semantic', trust_level: 'OBSERVED' });
    conflicts.markConflict(a.id, b.id);
    const updA = memory.get(a.id);
    const updB = memory.get(b.id);
    assert.strictEqual(updA.trust_level, 'CONFLICTED');
    assert.strictEqual(updB.trust_level, 'CONFLICTED');
  });

  // 5. markConflict pair shows in detect().contradictLinks
  await test('markConflict pair appears in detect().contradictLinks', async () => {
    const a = memory.add({ title: 'ContradA', content: 'C', memory_type: 'semantic' });
    const b = memory.add({ title: 'ContradB', content: 'C', memory_type: 'semantic' });
    conflicts.markConflict(a.id, b.id, 'test notes');
    const d = conflicts.detect();
    assert.ok(d.contradictLinks.some(l => l.from_id === a.id && l.to_id === b.id));
  });

  // 6. resolve('trust') sets trust_level to USER_CONFIRMED
  await test('resolve() with action=trust sets USER_CONFIRMED', async () => {
    const m = memory.add({ title: 'Resolve trust', content: 'C', memory_type: 'semantic', trust_level: 'CONFLICTED' });
    const r = conflicts.resolve(m.id, 'trust');
    assert.ok(r.ok);
    const updated = memory.get(m.id);
    assert.strictEqual(updated.trust_level, 'USER_CONFIRMED');
  });

  // 7. resolve('archive') archives the memory
  await test('resolve() with action=archive archives the memory', async () => {
    const m = memory.add({ title: 'Resolve archive', content: 'C', memory_type: 'semantic' });
    conflicts.resolve(m.id, 'archive');
    const updated = memory.get(m.id);
    assert.strictEqual(updated.status, 'archived');
  });

  // 8. resolve('downgrade') sets trust to OUTDATED
  await test('resolve() with action=downgrade sets OUTDATED', async () => {
    const m = memory.add({ title: 'Resolve downgrade', content: 'C', memory_type: 'semantic', trust_level: 'CONFLICTED' });
    conflicts.resolve(m.id, 'downgrade');
    const updated = memory.get(m.id);
    assert.strictEqual(updated.trust_level, 'OUTDATED');
  });

  // 9. API GET /api/conflicts returns expected shape
  await test('GET /api/conflicts returns {conflicted, contradictLinks, superseded}', async () => {
    const r = await req('GET', '/api/conflicts');
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.body.conflicted));
    assert.ok(Array.isArray(r.body.contradictLinks));
    assert.ok(Array.isArray(r.body.superseded));
  });

  // 10. API POST /api/conflicts marks conflict
  await test('POST /api/conflicts creates contradicts link', async () => {
    const cr1 = await req('POST', '/api/memories', { title: 'API Conf A', content: 'C', memory_type: 'semantic' });
    const cr2 = await req('POST', '/api/memories', { title: 'API Conf B', content: 'C', memory_type: 'semantic' });
    const r = await req('POST', '/api/conflicts', { id1: cr1.body.id, id2: cr2.body.id, notes: 'api test' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.rel_type, 'contradicts');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
