'use strict';
const assert = require('assert');
const http   = require('http');
const path   = require('path');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p75-${Date.now()}.db`);

function req(method, pathname, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = { hostname: '127.0.0.1', port: 7749, path: pathname, method,
                   headers: { 'X-Hive-Local': '1', ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) } };
    const r = http.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => { let b; try { b = JSON.parse(raw); } catch { b = raw; } resolve({ status: res.statusCode, body: b }); });
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

  console.log('\nPhase 75 — Memory Note / Sticky Comment\n');

  // 1. Create memory with note via POST
  await test('POST /api/memories accepts note field', async () => {
    const { status, body } = await req('POST', '/api/memories', { title: 'Noted memory', content: 'content here', memory_type: 'core', note: 'remember to review' });
    assert.strictEqual(status, 201);
    assert.strictEqual(body.note, 'remember to review');
  });

  // 2. note is returned in GET
  await test('GET /api/memories/:id returns note', async () => {
    const { body: created } = await req('POST', '/api/memories', { title: 'Note get test', content: 'x', memory_type: 'core', note: 'test note' });
    const { body: fetched } = await req('GET', `/api/memories/${created.id}`);
    assert.strictEqual(fetched.note, 'test note');
  });

  // 3. memory without note has null/undefined note
  await test('memory without note has null note', async () => {
    const { body } = await req('POST', '/api/memories', { title: 'No note', content: 'x', memory_type: 'core' });
    assert.ok(body.note === null || body.note === undefined, `expected null/undefined, got ${body.note}`);
  });

  // 4. PUT updates note
  await test('PUT /api/memories/:id updates note', async () => {
    const { body: m } = await req('POST', '/api/memories', { title: 'Update note', content: 'x', memory_type: 'core' });
    const { body: updated } = await req('PUT', `/api/memories/${m.id}`, { note: 'updated note' });
    assert.strictEqual(updated.note, 'updated note');
  });

  // 5. PUT can clear note by setting to null
  await test('PUT can clear note by setting null', async () => {
    const { body: m } = await req('POST', '/api/memories', { title: 'Clear note', content: 'x', memory_type: 'core', note: 'to be cleared' });
    const { body: updated } = await req('PUT', `/api/memories/${m.id}`, { note: null });
    assert.ok(updated.note === null || updated.note === undefined, `expected null, got ${updated.note}`);
  });

  // 6. note in list endpoint
  await test('note appears in GET /api/memories list', async () => {
    const { body: m } = await req('POST', '/api/memories', { title: 'List note', content: 'x', memory_type: 'core', note: 'list check' });
    const { body: list } = await req('GET', '/api/memories?limit=100');
    const found = list.find(x => x.id === m.id);
    assert.ok(found, 'memory not found in list');
    assert.strictEqual(found.note, 'list check');
  });

  const html = (await req('GET', '/')).body;

  // 7. HTML has nm-nt textarea in add modal
  await test('HTML has #nm-nt note textarea', async () => {
    assert.ok(html.includes('id="nm-nt"'), 'expected nm-nt textarea');
  });

  // 8. HTML has editNote function
  await test('HTML has editNote function', async () => {
    assert.ok(html.includes('function editNote('), 'expected editNote function');
  });

  // 9. card renders note display (amber border-left style)
  await test('card HTML includes note display logic', async () => {
    assert.ok(html.includes('border-left:2px solid #d29922'), 'expected amber note border style in card');
  });

  // 10. card renders add note button when no note
  await test('card HTML includes add note button', async () => {
    assert.ok(html.includes('add note'), 'expected "add note" button text in card');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
