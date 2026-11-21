'use strict';
const assert = require('assert');
const http   = require('http');
const path   = require('path');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p73-${Date.now()}.db`);

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

  console.log('\nPhase 73 — Tag Suggestions\n');

  // Seed memories with known tags
  await req('POST', '/api/memories', { title: 'JS memory',   content: 'x', memory_type: 'core',   tags: ['javascript', 'async'] });
  await req('POST', '/api/memories', { title: 'TS memory',   content: 'x', memory_type: 'domain', tags: ['typescript', 'javascript'] });
  await req('POST', '/api/memories', { title: 'Node memory', content: 'x', memory_type: 'core',   tags: ['nodejs', 'async', 'backend'] });

  const html = (await req('GET', '/')).body;

  // 1. /api/tags returns the seeded tags
  await test('/api/tags returns tag list', async () => {
    const { status, body } = await req('GET', '/api/tags');
    assert.strictEqual(status, 200);
    assert.ok(Array.isArray(body), 'should be array');
    const tags = body.map(t => t.tag);
    assert.ok(tags.includes('javascript'), 'should include javascript');
    assert.ok(tags.includes('async'), 'should include async');
  });

  // 2. /api/tags has count field
  await test('/api/tags entries have tag and count fields', async () => {
    const { body } = await req('GET', '/api/tags');
    assert.ok(body.length > 0, 'should have tags');
    assert.ok('tag' in body[0] && 'count' in body[0], 'each entry needs tag+count');
  });

  // 3. javascript appears with count >= 2 (used in 2 memories)
  await test('javascript tag has count >= 2', async () => {
    const { body } = await req('GET', '/api/tags');
    const jsTags = body.filter(t => t.tag === 'javascript');
    assert.strictEqual(jsTags.length, 1);
    assert.ok(jsTags[0].count >= 2, `expected count>=2, got ${jsTags[0].count}`);
  });

  // 4. HTML has the nm-tg input
  await test('HTML has #nm-tg tag input', async () => {
    assert.ok(html.includes('id="nm-tg"'), 'expected nm-tg input');
  });

  // 5. HTML has oninput=tagSuggest on the tag input
  await test('nm-tg input has oninput=tagSuggest', async () => {
    assert.ok(html.includes('oninput="tagSuggest(this)"'), 'expected tagSuggest oninput handler');
  });

  // 6. HTML has suggestion dropdown #nm-tg-sug
  await test('HTML has #nm-tg-sug suggestion dropdown', async () => {
    assert.ok(html.includes('id="nm-tg-sug"'), 'expected nm-tg-sug dropdown div');
  });

  // 7. HTML has tagSuggest function defined
  await test('HTML has tagSuggest function', async () => {
    assert.ok(html.includes('async function tagSuggest('), 'expected tagSuggest function');
  });

  // 8. HTML has pickTagSug function defined
  await test('HTML has pickTagSug function', async () => {
    assert.ok(html.includes('function pickTagSug('), 'expected pickTagSug function');
  });

  // 9. HTML has _loadAllTags function
  await test('HTML has _loadAllTags function', async () => {
    assert.ok(html.includes('async function _loadAllTags('), 'expected _loadAllTags function');
  });

  // 10. HTML has _allTags variable for caching
  await test('HTML has _allTags cache variable', async () => {
    assert.ok(html.includes('let _allTags'), 'expected _allTags variable');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
