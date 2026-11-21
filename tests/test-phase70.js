'use strict';
const assert = require('assert');
const http   = require('http');
const path   = require('path');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p70-${Date.now()}.db`);

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

  console.log('\nPhase 70 — Inline Tag Editor\n');

  // Seed a memory with tags
  const { body: m } = await req('POST', '/api/memories', {
    title: 'Tag edit test', content: 'some content', memory_type: 'core',
    tags: ['alpha', 'beta', 'gamma']
  });

  const html = (await req('GET', '/')).body;

  // 1. dashboard has removeTag function
  await test('dashboard has removeTag function', async () => {
    assert.ok(html.includes('function removeTag('), 'expected removeTag in HTML');
  });

  // 2. dashboard has renameTagInline function
  await test('dashboard has renameTagInline function', async () => {
    assert.ok(html.includes('function renameTagInline('), 'expected renameTagInline in HTML');
  });

  // 3. card tags include ✕ remove button
  await test('card() tags include ✕ remove button', async () => {
    assert.ok(html.includes('removeTag('), 'expected removeTag call in card tags');
    assert.ok(html.includes('Remove tag'), 'expected Remove tag title on ✕ button');
  });

  // 4. card tags include dblclick rename handler
  await test('card() tags have ondblclick rename handler', async () => {
    assert.ok(html.includes('renameTagInline('), 'expected renameTagInline call in card tags');
    assert.ok(html.includes('ondblclick'), 'expected ondblclick in tag HTML');
  });

  // 5. removeTag removes the correct tag via PUT
  await test('removeTag: PUT with filtered tags removes one tag', async () => {
    const before = await req('GET', `/api/memories/${m.id}`);
    assert.ok(before.body.tags.includes('alpha'), 'expected alpha tag before removal');
    // Simulate removeTag: GET then PUT without 'alpha'
    const tags = before.body.tags.filter(t => t !== 'alpha');
    const { status, body } = await req('PUT', `/api/memories/${m.id}`, { tags });
    assert.strictEqual(status, 200);
    assert.ok(!body.tags.includes('alpha'), 'alpha should be removed');
    assert.ok(body.tags.includes('beta'), 'beta should remain');
    assert.ok(body.tags.includes('gamma'), 'gamma should remain');
  });

  // 6. rename tag via PUT replaces old tag name
  await test('renaming a tag via PUT replaces old name with new', async () => {
    const before = await req('GET', `/api/memories/${m.id}`);
    const tags = before.body.tags.map(t => t === 'beta' ? 'delta' : t);
    const { status, body } = await req('PUT', `/api/memories/${m.id}`, { tags });
    assert.strictEqual(status, 200);
    assert.ok(!body.tags.includes('beta'), 'beta should be replaced');
    assert.ok(body.tags.includes('delta'), 'delta should be present');
  });

  // 7. removing last tag results in empty array (not error)
  await test('removing all tags results in empty tags array', async () => {
    const { status, body } = await req('PUT', `/api/memories/${m.id}`, { tags: [] });
    assert.strictEqual(status, 200);
    assert.deepStrictEqual(body.tags, [], 'expected empty tags array');
  });

  // 8. tag ✕ buttons have stopPropagation to avoid filterTag
  await test('✕ button click uses event.stopPropagation()', async () => {
    assert.ok(html.includes('event.stopPropagation()'), 'expected stopPropagation in tag ✕ handler');
  });

  // 9. renameTagInline creates inline input (checks for inp element logic)
  await test('renameTagInline creates input element for inline editing', async () => {
    assert.ok(html.includes("document.createElement('input')"), 'expected createElement input in renameTagInline');
    assert.ok(html.includes('inp.replaceWith') || html.includes('replaceWith(inp)'), 'expected replaceWith(inp) in renameTagInline');
  });

  // 10. renameTagInline handles Escape key to cancel
  await test('renameTagInline handles Escape key to cancel', async () => {
    assert.ok(html.includes("'Escape'"), 'expected Escape key handler in renameTagInline');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
