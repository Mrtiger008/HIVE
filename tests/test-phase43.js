'use strict';
const assert = require('assert');
const path   = require('path');
const http   = require('http');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p43-${Date.now()}.db`);

const memory  = require('../src/memory');
const compare = require('../src/compare');

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

  console.log('\nPhase 43 — Memory Compare\n');

  const a = memory.add({ title: 'Alpha', content: 'line one\nline two\nline three',
    memory_type: 'core', domain: 'tech', confidence: 0.9, importance: 8 });
  const b = memory.add({ title: 'Beta',  content: 'line one\nline TWO\nline four',
    memory_type: 'semantic', domain: 'tech', confidence: 0.6, importance: 5 });

  // 1. diff() returns expected shape
  await test('diff() returns {a, b, fields, content_diff, changed_count, content_identical}', async () => {
    const d = compare.diff(a.id, b.id);
    assert.ok(d.a && d.b);
    assert.ok(Array.isArray(d.fields));
    assert.ok(Array.isArray(d.content_diff));
    assert.ok(typeof d.changed_count === 'number');
    assert.ok(typeof d.content_identical === 'boolean');
  });

  // 2. fields cover all COMPARE_FIELDS
  await test('fields array covers all COMPARE_FIELDS', async () => {
    const d = compare.diff(a.id, b.id);
    for (const f of compare.COMPARE_FIELDS) {
      assert.ok(d.fields.some(x => x.field === f), `missing field: ${f}`);
    }
  });

  // 3. changed fields detected correctly
  await test('changed fields detected (title, memory_type, confidence, importance)', async () => {
    const d = compare.diff(a.id, b.id);
    const changed = new Set(d.fields.filter(f => f.changed).map(f => f.field));
    assert.ok(changed.has('title'),       'title should be changed');
    assert.ok(changed.has('memory_type'), 'memory_type should be changed');
    assert.ok(changed.has('confidence'), 'confidence should be changed');
  });

  // 4. unchanged fields reported correctly
  await test('unchanged domain field reported as not changed', async () => {
    const d = compare.diff(a.id, b.id);
    const domainF = d.fields.find(f => f.field === 'domain');
    assert.ok(domainF && !domainF.changed, 'domain should not be changed');
  });

  // 5. content_identical false for differing content
  await test('content_identical=false when contents differ', async () => {
    const d = compare.diff(a.id, b.id);
    assert.strictEqual(d.content_identical, false);
  });

  // 6. content_identical true for identical content
  await test('content_identical=true when both memories have same content', async () => {
    const c1 = memory.add({ title: 'C1', content: 'same text', memory_type: 'semantic' });
    const c2 = memory.add({ title: 'C2', content: 'same text', memory_type: 'semantic' });
    const d = compare.diff(c1.id, c2.id);
    assert.strictEqual(d.content_identical, true);
    assert.ok(d.content_diff.every(op => op.type === 'eq'), 'all ops should be eq');
  });

  // 7. lineDiff returns correct add/del/eq ops
  await test('lineDiff() returns add/del/eq ops correctly', async () => {
    const diff = compare.lineDiff('a\nb\nc', 'a\nX\nc');
    assert.ok(diff.some(op => op.type === 'del' && op.text === 'b'), 'should have del b');
    assert.ok(diff.some(op => op.type === 'add' && op.text === 'X'), 'should have add X');
    assert.ok(diff.some(op => op.type === 'eq'  && op.text === 'a'), 'should have eq a');
  });

  // 8. diff() throws for unknown id
  await test('diff() throws for unknown memory id', async () => {
    assert.throws(() => compare.diff('nonexistent', a.id), /Memory not found/);
  });

  // 9. API GET /api/memories/compare returns 400 without ids
  await test('GET /api/memories/compare without ids returns 400', async () => {
    const r = await req('GET', '/api/memories/compare');
    assert.strictEqual(r.status, 400);
    assert.ok(r.body.error);
  });

  // 10. API GET /api/memories/compare returns diff for ids created via API
  await test('GET /api/memories/compare returns diff shape for valid ids', async () => {
    const r1 = await req('POST', '/api/memories', { title: 'CmpX', content: 'hello', memory_type: 'core' });
    const r2 = await req('POST', '/api/memories', { title: 'CmpY', content: 'world', memory_type: 'semantic' });
    assert.strictEqual(r1.status, 201, 'failed to create memory 1');
    assert.strictEqual(r2.status, 201, 'failed to create memory 2');
    const r = await req('GET', `/api/memories/compare?id1=${r1.body.id}&id2=${r2.body.id}`);
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.a && r.body.b);
    assert.ok(Array.isArray(r.body.fields));
    assert.ok(typeof r.body.changed_count === 'number');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
