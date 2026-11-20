'use strict';
const assert = require('assert');
const path   = require('path');
const http   = require('http');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p56-${Date.now()}.db`);

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

async function add(title, content) {
  const r = await req('POST', '/api/memories', { title, content, memory_type: 'semantic' });
  return r.body;
}

async function run() {
  let passed = 0;
  const total = 10;
  async function test(name, fn) {
    try { await fn(); console.log(`  ✓ ${name}`); passed++; }
    catch (e) { console.log(`  ✗ ${name}: ${e.message}`); }
  }

  console.log('\nPhase 56 — Memory Diff Viewer\n');

  const uid = `p56_${Date.now()}`;
  const m = await add(`${uid} Original`, 'line one\nline two\nline three');
  // Edit to create a version snapshot
  await req('PUT', `/api/memories/${m.id}`, { content: 'line one\nline two changed\nline three\nline four added' });

  // 1. versions list returns at least one version after edit
  await test('versions list has at least one entry after edit', async () => {
    const r = await req('GET', `/api/memories/${m.id}/versions`);
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.length >= 1, `expected >=1 versions, got ${r.body.length}`);
  });

  // 2. /api/versions/:id/diff returns 200 with diff array
  await test('GET /api/versions/:id/diff returns diff array', async () => {
    const versions = await req('GET', `/api/memories/${m.id}/versions`);
    const vid = versions.body[0].id;
    const r = await req('GET', `/api/versions/${vid}/diff`);
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.body.diff), 'expected diff array');
    assert.ok(r.body.diff.length > 0, 'expected non-empty diff');
  });

  // 3. diff ops have type and text fields
  await test('diff ops each have type and text fields', async () => {
    const versions = await req('GET', `/api/memories/${m.id}/versions`);
    const vid = versions.body[0].id;
    const r = await req('GET', `/api/versions/${vid}/diff`);
    for (const op of r.body.diff) {
      assert.ok(['eq','add','del'].includes(op.type), `unexpected op type: ${op.type}`);
      assert.ok(typeof op.text === 'string', 'op.text should be a string');
    }
  });

  // 4. diff detects deleted lines
  await test('diff includes del ops for removed/changed lines', async () => {
    const versions = await req('GET', `/api/memories/${m.id}/versions`);
    const vid = versions.body[0].id;
    const r = await req('GET', `/api/versions/${vid}/diff`);
    const hasDel = r.body.diff.some(op => op.type === 'del');
    assert.ok(hasDel, 'expected at least one del op');
  });

  // 5. diff detects added lines
  await test('diff includes add ops for new/changed lines', async () => {
    const versions = await req('GET', `/api/memories/${m.id}/versions`);
    const vid = versions.body[0].id;
    const r = await req('GET', `/api/versions/${vid}/diff`);
    const hasAdd = r.body.diff.some(op => op.type === 'add');
    assert.ok(hasAdd, 'expected at least one add op');
  });

  // 6. diff includes eq ops for unchanged lines
  await test('diff includes eq ops for unchanged lines', async () => {
    const versions = await req('GET', `/api/memories/${m.id}/versions`);
    const vid = versions.body[0].id;
    const r = await req('GET', `/api/versions/${vid}/diff`);
    const hasEq = r.body.diff.some(op => op.type === 'eq');
    assert.ok(hasEq, 'expected at least one eq op (line one is unchanged)');
  });

  // 7. /api/versions/:id/diff returns 404 for nonexistent version
  await test('diff returns 404 for nonexistent version id', async () => {
    const r = await req('GET', '/api/versions/999999/diff');
    assert.strictEqual(r.status, 404);
  });

  // 8. version object has snapshot_at timestamp
  await test('version object has snapshot_at timestamp', async () => {
    const r = await req('GET', `/api/memories/${m.id}/versions`);
    const v = r.body[0];
    assert.ok(v.snapshot_at, 'expected snapshot_at field');
    assert.ok(typeof v.snapshot_at === 'number', 'snapshot_at should be a number');
  });

  // 9. dashboard HTML has _renderSideBySide and toggleDiffMode
  await test('dashboard HTML has side-by-side diff functions', async () => {
    const r = await new Promise((resolve, reject) => {
      const o = http.request({ hostname:'127.0.0.1', port:7749, path:'/', method:'GET' }, res => {
        let raw = ''; res.on('data', c => raw += c); res.on('end', () => resolve(raw));
      });
      o.on('error', reject); o.end();
    });
    assert.ok(r.includes('_renderSideBySide'), 'expected _renderSideBySide in HTML');
    assert.ok(r.includes('toggleDiffMode'),    'expected toggleDiffMode in HTML');
    assert.ok(r.includes('_renderUnified'),    'expected _renderUnified in HTML');
  });

  // 10. dashboard HTML has hist-diff-toggle button
  await test('dashboard HTML has mode toggle button', async () => {
    const r = await new Promise((resolve, reject) => {
      const o = http.request({ hostname:'127.0.0.1', port:7749, path:'/', method:'GET' }, res => {
        let raw = ''; res.on('data', c => raw += c); res.on('end', () => resolve(raw));
      });
      o.on('error', reject); o.end();
    });
    assert.ok(r.includes('hist-diff-toggle'), 'expected hist-diff-toggle button in HTML');
    assert.ok(r.includes('Switch to unified'), 'expected toggle button text in HTML');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
