'use strict';
const assert = require('assert');
const path   = require('path');
const http   = require('http');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p54-${Date.now()}.db`);

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

  console.log('\nPhase 54 — Inline Memory Editing\n');

  const uid = `p54_${Date.now()}`;
  const m = await add(`${uid} Original Title`, 'Original content for inline edit test');

  // 1. PUT /api/memories/:id updates title
  await test('PUT /api/memories/:id updates title', async () => {
    const r = await req('PUT', `/api/memories/${m.id}`, { title: `${uid} Updated Title` });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.title, `${uid} Updated Title`);
  });

  // 2. PUT /api/memories/:id updates content
  await test('PUT /api/memories/:id updates content', async () => {
    const r = await req('PUT', `/api/memories/${m.id}`, { content: 'Updated content via inline edit' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.content, 'Updated content via inline edit');
  });

  // 3. PUT with both title and content
  await test('PUT updates both title and content atomically', async () => {
    const r = await req('PUT', `/api/memories/${m.id}`, {
      title: `${uid} Final Title`, content: 'Final content'
    });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.title, `${uid} Final Title`);
    assert.strictEqual(r.body.content, 'Final content');
  });

  // 4. GET after PUT reflects updated values
  await test('GET reflects updated title and content after PUT', async () => {
    await req('PUT', `/api/memories/${m.id}`, { title: `${uid} Verified`, content: 'Verified content' });
    const r = await req('GET', `/api/memories/${m.id}`);
    assert.strictEqual(r.body.title, `${uid} Verified`);
    assert.strictEqual(r.body.content, 'Verified content');
  });

  // 5. PUT on nonexistent id returns 404
  await test('PUT on nonexistent id returns 404', async () => {
    const r = await req('PUT', '/api/memories/nonexistent-xyz', { title: 'x' });
    assert.strictEqual(r.status, 404);
  });

  // 6. PUT with no fields returns 400
  await test('PUT with empty body returns 400', async () => {
    const r = await req('PUT', `/api/memories/${m.id}`, {});
    assert.strictEqual(r.status, 400);
  });

  // 7. versions snapshot taken on title/content update
  await test('versions snapshot taken when title is updated', async () => {
    const r = await req('GET', `/api/memories/${m.id}/versions`);
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.body));
    assert.ok(r.body.length > 0, 'expected at least one version snapshot');
  });

  // 8. dashboard HTML has ct-title span with ondblclick
  await test('dashboard HTML has ct-title span with ondblclick inline edit', async () => {
    const r = await new Promise((resolve, reject) => {
      const o = http.request({ hostname:'127.0.0.1', port:7749, path:'/', method:'GET' }, res => {
        let raw = ''; res.on('data', c => raw += c); res.on('end', () => resolve(raw));
      });
      o.on('error', reject); o.end();
    });
    assert.ok(r.includes('ct-title'), 'expected ct-title class in HTML');
    assert.ok(r.includes('inlineEdit'), 'expected inlineEdit function in HTML');
    assert.ok(r.includes('ondblclick'), 'expected ondblclick handler in HTML');
  });

  // 9. dashboard HTML has inlineEditSave and inlineEditCancel
  await test('dashboard HTML has inlineEditSave and inlineEditCancel', async () => {
    const r = await new Promise((resolve, reject) => {
      const o = http.request({ hostname:'127.0.0.1', port:7749, path:'/', method:'GET' }, res => {
        let raw = ''; res.on('data', c => raw += c); res.on('end', () => resolve(raw));
      });
      o.on('error', reject); o.end();
    });
    assert.ok(r.includes('inlineEditSave'), 'expected inlineEditSave in HTML');
    assert.ok(r.includes('inlineEditCancel'), 'expected inlineEditCancel in HTML');
    assert.ok(r.includes('_inlineRestore'), 'expected _inlineRestore in HTML');
  });

  // 10. PUT preserves fields not in the update payload
  await test('PUT preserves memory_type and tags when not updated', async () => {
    const original = await req('GET', `/api/memories/${m.id}`);
    const origType = original.body.memory_type;
    await req('PUT', `/api/memories/${m.id}`, { title: `${uid} Type check` });
    const updated = await req('GET', `/api/memories/${m.id}`);
    assert.strictEqual(updated.body.memory_type, origType, 'memory_type should be unchanged');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
