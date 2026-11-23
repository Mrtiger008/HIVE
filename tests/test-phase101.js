'use strict';
const assert = require('assert');
const http   = require('http');
const path   = require('path');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p101-${Date.now()}.db`);

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

  console.log('\nPhase 101 — JSON Import\n');

  const batch = [
    { title: 'Imported Alpha', content: 'alpha imported content here', memory_type: 'core',     tags: ['import','test'] },
    { title: 'Imported Beta',  content: 'beta imported content here',  memory_type: 'semantic', tags: ['import'] },
    { title: 'Imported Gamma', content: 'gamma imported content here', domain: 'engineering'   },
  ];

  // 1. endpoint returns 200
  await test('POST /api/import/json returns 200', async () => {
    const { status } = await req('POST', '/api/import/json', { memories: batch });
    assert.strictEqual(status, 200);
  });

  // 2. returns imported count
  await test('response includes imported count', async () => {
    const { body } = await req('POST', '/api/import/json', { memories: batch });
    assert.ok('imported' in body, 'expected imported field');
    assert.ok(typeof body.imported === 'number');
  });

  // 3. returns errors array
  await test('response includes errors array', async () => {
    const { body } = await req('POST', '/api/import/json', { memories: batch });
    assert.ok(Array.isArray(body.errors), 'expected errors array');
  });

  // 4. all three valid memories are imported
  await test('all 3 valid memories imported', async () => {
    const { body } = await req('POST', '/api/import/json', { memories: batch });
    assert.ok(body.imported >= 3, `expected imported >= 3, got ${body.imported}`);
    assert.strictEqual(body.errors.length, 0, 'expected no errors');
  });

  // 5. imported memories appear in list
  await test('imported memories appear in GET /api/memories', async () => {
    // import fresh batch with unique title to find
    const unique = `UniqueTitle${Date.now()}`;
    await req('POST', '/api/import/json', { memories: [{ title: unique, content: 'unique content here', memory_type: 'core' }] });
    const { body } = await req('GET', `/api/memories?limit=1000`);
    assert.ok(body.some(m => m.title === unique), 'imported memory should appear in list');
  });

  // 6. tags are preserved on imported memories
  await test('tags preserved on imported memories', async () => {
    const unique = `TaggedImport${Date.now()}`;
    await req('POST', '/api/import/json', { memories: [{ title: unique, content: 'tagged content here', tags: ['xtag1','xtag2'] }] });
    const { body } = await req('GET', `/api/memories?limit=1000`);
    const m = body.find(x => x.title === unique);
    assert.ok(m, 'imported memory not found');
    assert.ok(m.tags.includes('xtag1') && m.tags.includes('xtag2'), 'tags should be preserved');
  });

  // 7. empty memories array returns 400
  await test('empty memories array returns 400', async () => {
    const { status } = await req('POST', '/api/import/json', { memories: [] });
    assert.strictEqual(status, 400);
  });

  // 8. missing memories key returns 400
  await test('missing memories key returns 400', async () => {
    const { status } = await req('POST', '/api/import/json', { data: [] });
    assert.strictEqual(status, 400);
  });

  // 9. items missing title/content produce errors, valid ones still import
  await test('invalid items produce errors, valid ones still import', async () => {
    const mixed = [
      { title: `Valid${Date.now()}`, content: 'valid content here' },
      { content: 'missing title' },
      { title: 'missing content' },
    ];
    const { body } = await req('POST', '/api/import/json', { memories: mixed });
    assert.strictEqual(body.imported, 1, `expected 1 imported, got ${body.imported}`);
    assert.ok(body.errors.length >= 2, `expected >= 2 errors, got ${body.errors.length}`);
  });

  const html = (await req('GET', '/')).body;

  // 10. HTML has jsonImportAll function
  await test('HTML has jsonImportAll function', async () => {
    assert.ok(html.includes('jsonImportAll'), 'expected jsonImportAll in HTML');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
