'use strict';
const assert = require('assert');
const path   = require('path');
const http   = require('http');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p61-${Date.now()}.db`);

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

async function add(title, opts = {}) {
  return (await req('POST', '/api/memories', {
    title, content: opts.content || 'content for ' + title,
    memory_type: opts.memory_type || 'semantic',
    tags: opts.tags || [],
    importance: opts.importance || 5,
    domain: opts.domain || undefined,
  })).body;
}

async function run() {
  let passed = 0;
  const total = 10;
  async function test(name, fn) {
    try { await fn(); console.log(`  ✓ ${name}`); passed++; }
    catch (e) { console.log(`  ✗ ${name}: ${e.message}`); }
  }

  console.log('\nPhase 61 — Memory Duplication\n');

  const uid = `p61_${Date.now()}`;
  const src = await add(`${uid} Original`, {
    content: 'original content here',
    memory_type: 'core',
    tags: ['tag-a', 'tag-b'],
    importance: 8,
    domain: 'test-domain',
  });

  // 1. POST /api/memories/:id/duplicate returns 200
  await test('POST /api/memories/:id/duplicate returns 200', async () => {
    const r = await req('POST', `/api/memories/${src.id}/duplicate`);
    assert.strictEqual(r.status, 200);
  });

  // 2. duplicate has "Copy of " prefix on title
  await test('duplicate title has "Copy of " prefix', async () => {
    const r = await req('POST', `/api/memories/${src.id}/duplicate`);
    assert.ok(r.body.title.startsWith('Copy of '), `expected "Copy of " prefix, got: ${r.body.title}`);
    assert.ok(r.body.title.includes(src.title), 'title should include original title');
  });

  // 3. duplicate copies content
  await test('duplicate copies content verbatim', async () => {
    const r = await req('POST', `/api/memories/${src.id}/duplicate`);
    assert.strictEqual(r.body.content, src.content);
  });

  // 4. duplicate copies memory_type
  await test('duplicate copies memory_type', async () => {
    const r = await req('POST', `/api/memories/${src.id}/duplicate`);
    assert.strictEqual(r.body.memory_type, src.memory_type);
  });

  // 5. duplicate copies tags
  await test('duplicate copies tags', async () => {
    const r = await req('POST', `/api/memories/${src.id}/duplicate`);
    const tags = r.body.tags || [];
    assert.ok(tags.includes('tag-a'), 'tag-a should be copied');
    assert.ok(tags.includes('tag-b'), 'tag-b should be copied');
  });

  // 6. duplicate copies importance
  await test('duplicate copies importance', async () => {
    const r = await req('POST', `/api/memories/${src.id}/duplicate`);
    assert.strictEqual(r.body.importance, src.importance);
  });

  // 7. duplicate gets a new id
  await test('duplicate has a different id from source', async () => {
    const r = await req('POST', `/api/memories/${src.id}/duplicate`);
    assert.ok(r.body.id, 'duplicate should have an id');
    assert.notStrictEqual(r.body.id, src.id);
  });

  // 8. original is unaffected after duplication
  await test('original memory is unmodified after duplicate', async () => {
    await req('POST', `/api/memories/${src.id}/duplicate`);
    const original = (await req('GET', `/api/memories/${src.id}`)).body;
    assert.strictEqual(original.title, src.title, 'original title unchanged');
    assert.strictEqual(original.status, 'active', 'original still active');
  });

  // 9. duplicate is independently editable
  await test('duplicate can be edited independently', async () => {
    const dup = (await req('POST', `/api/memories/${src.id}/duplicate`)).body;
    const updated = (await req('PUT', `/api/memories/${dup.id}`, { title: 'Renamed Dup', content: dup.content })).body;
    assert.strictEqual(updated.title, 'Renamed Dup');
    const orig = (await req('GET', `/api/memories/${src.id}`)).body;
    assert.strictEqual(orig.title, src.title, 'original title still unchanged');
  });

  // 10. dashboard HTML has duplicateMem function and ⧉ dupe button
  await test('dashboard HTML has duplicateMem function and dupe button', async () => {
    const r = await new Promise((resolve, reject) => {
      const o = http.request({ hostname:'127.0.0.1', port:7749, path:'/', method:'GET' }, res => {
        let raw = ''; res.on('data', c => raw += c); res.on('end', () => resolve(raw));
      });
      o.on('error', reject); o.end();
    });
    assert.ok(r.includes('duplicateMem'), 'expected duplicateMem in HTML');
    assert.ok(r.includes('⧉ dupe'), 'expected ⧉ dupe button in HTML');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
