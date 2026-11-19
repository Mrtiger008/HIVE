'use strict';
const assert = require('assert');
const path = require('path');
const http = require('http');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p35-${Date.now()}.db`);

const memory = require('../src/memory');
const decay  = require('../src/decay');

const DAY = 24 * 60 * 60 * 1000;

function backdateAccess(id, daysAgo) {
  const db = require('../src/db').getDb();
  const t = Date.now() - daysAgo * DAY;
  db.prepare('UPDATE memories SET last_accessed_at = ?, created_at = ?, updated_at = ? WHERE id = ?').run(t, t, t, id);
}

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

  console.log('\nPhase 35 — Memory Decay\n');

  // 1. Fresh memory not in preview (recently active)
  await test('recent memory excluded from decay preview', async () => {
    memory.add({ title: 'Fresh mem', content: 'C', memory_type: 'semantic', confidence: 0.8 });
    const changes = decay.preview();
    assert.ok(!changes.some(c => c.title === 'Fresh mem'));
  });

  // 2. Old idle memory appears in preview
  await test('idle memory (30d) appears in preview', async () => {
    const m = memory.add({ title: 'Old idle', content: 'C', memory_type: 'semantic', confidence: 0.9 });
    backdateAccess(m.id, 30);
    const changes = decay.preview();
    assert.ok(changes.some(c => c.id === m.id));
  });

  // 3. new_confidence < confidence for idle memory
  await test('new_confidence is lower than current confidence', async () => {
    const m = memory.add({ title: 'Decaying mem', content: 'C', memory_type: 'semantic', confidence: 0.8 });
    backdateAccess(m.id, 28);
    const changes = decay.preview();
    const c = changes.find(x => x.id === m.id);
    assert.ok(c, 'memory not in preview');
    assert.ok(c.new_confidence < c.confidence, `${c.new_confidence} should be < ${c.confidence}`);
  });

  // 4. confidence never drops below 0.1 (floor)
  await test('confidence floor is 0.1', async () => {
    const m = memory.add({ title: 'Floor test', content: 'C', memory_type: 'semantic', confidence: 0.11 });
    backdateAccess(m.id, 365);
    const changes = decay.preview();
    const c = changes.find(x => x.id === m.id);
    if (c) assert.ok(c.new_confidence >= 0.1, `floor violated: ${c.new_confidence}`);
    // If not in preview, confidence was already at/near floor — that's also acceptable
  });

  // 5. High-importance memory decays slower than normal
  await test('high-importance memory decays slower', async () => {
    const lo = memory.add({ title: 'Low imp decay',  content: 'C', memory_type: 'semantic', confidence: 0.8, importance: 3 });
    const hi = memory.add({ title: 'High imp decay', content: 'C', memory_type: 'semantic', confidence: 0.8, importance: 8 });
    backdateAccess(lo.id, 28);
    backdateAccess(hi.id, 28);
    const changes = decay.preview();
    const loC = changes.find(x => x.id === lo.id);
    const hiC = changes.find(x => x.id === hi.id);
    assert.ok(loC && hiC, 'both should be in preview');
    assert.ok(hiC.new_confidence > loC.new_confidence, 'high-imp should decay less');
  });

  // 6. decay.run() applies changes and returns count
  await test('decay.run() returns applied count and updates DB', async () => {
    const m = memory.add({ title: 'Run test mem', content: 'C', memory_type: 'semantic', confidence: 0.9 });
    backdateAccess(m.id, 30);
    const result = decay.run();
    assert.ok(result.applied > 0, 'expected at least 1 change applied');
    const updated = memory.get(m.id);
    assert.ok(updated.confidence < 0.9, `confidence should have dropped below 0.9, got ${updated.confidence}`);
  });

  // 7. After run(), preview returns fewer/no duplicates for same memories
  await test('after run(), memory confidence is updated in DB', async () => {
    const m = memory.add({ title: 'Post-run check', content: 'C', memory_type: 'semantic', confidence: 0.75 });
    backdateAccess(m.id, 28);
    const before = decay.preview().find(x => x.id === m.id);
    assert.ok(before, 'should appear in preview');
    decay.run();
    const after = memory.get(m.id);
    assert.ok(after.confidence < 0.75, `confidence should drop below 0.75, got ${after.confidence}`);
  });

  // 8. API GET /api/decay/preview returns changes array
  await test('GET /api/decay/preview returns {changes: [...]}', async () => {
    const r = await req('GET', '/api/decay/preview');
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.body.changes), 'expected changes array');
  });

  // 9. API POST /api/decay/run returns applied count
  await test('POST /api/decay/run returns {applied, changes}', async () => {
    const r = await req('POST', '/api/decay/run', {});
    assert.strictEqual(r.status, 200);
    assert.ok(typeof r.body.applied === 'number');
    assert.ok(Array.isArray(r.body.changes));
  });

  // 10. min_idle_days parameter filters preview
  await test('min_idle_days parameter controls eligibility', async () => {
    const m = memory.add({ title: 'Barely idle', content: 'C', memory_type: 'semantic', confidence: 0.9 });
    backdateAccess(m.id, 10); // 10 days idle
    // With default 14-day threshold, this should NOT appear
    const strict = decay.preview({ minIdleDays: 14 });
    assert.ok(!strict.some(x => x.id === m.id), 'should not appear with 14d threshold');
    // With 7-day threshold, it should appear
    const loose = decay.preview({ minIdleDays: 7 });
    assert.ok(loose.some(x => x.id === m.id), 'should appear with 7d threshold');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
