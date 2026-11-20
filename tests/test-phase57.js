'use strict';
const assert = require('assert');
const path   = require('path');
const http   = require('http');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p57-${Date.now()}.db`);

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

async function add(title, tags = []) {
  const r = await req('POST', '/api/memories', { title, content: 'content for ' + title, memory_type: 'semantic', tags });
  return r.body;
}

function suggest(q) {
  return req('GET', '/api/search/suggest?q=' + encodeURIComponent(q));
}

async function run() {
  let passed = 0;
  const total = 10;
  async function test(name, fn) {
    try { await fn(); console.log(`  ✓ ${name}`); passed++; }
    catch (e) { console.log(`  ✗ ${name}: ${e.message}`); }
  }

  console.log('\nPhase 57 — Smart Search Suggestions\n');

  const uid = `p57_${Date.now()}`;
  await add(`${uid} Alpha Retrieval`, ['alpha-tag', 'shared-tag']);
  await add(`${uid} Alpha Beta Memory`, ['beta-tag', 'shared-tag']);
  await add(`${uid} Gamma Delta Note`, ['gamma-tag']);

  // 1. endpoint exists and returns 200
  await test('GET /api/search/suggest returns 200', async () => {
    const r = await suggest(uid + ' Alpha');
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.body), 'expected array');
  });

  // 2. returns matching title suggestions
  await test('returns matching memory titles', async () => {
    const r = await suggest(uid + ' Alpha');
    const titles = r.body.filter(x => x.type === 'title').map(x => x.label);
    assert.ok(titles.length >= 1, 'expected at least one title match');
    assert.ok(titles.some(t => t.includes('Alpha')), 'expected Alpha in results');
  });

  // 3. each result has type and label
  await test('each suggestion has type and label fields', async () => {
    const r = await suggest(uid);
    for (const item of r.body) {
      assert.ok(typeof item.type === 'string', 'type should be string');
      assert.ok(typeof item.label === 'string', 'label should be string');
    }
  });

  // 4. type is title or tag
  await test('type is either title or tag', async () => {
    const r = await suggest(uid);
    for (const item of r.body) {
      assert.ok(['title', 'tag'].includes(item.type), `unexpected type: ${item.type}`);
    }
  });

  // 5. returns tag suggestions for matching tags
  await test('returns matching tags', async () => {
    const r = await suggest('shared-tag');
    const tags = r.body.filter(x => x.type === 'tag');
    assert.ok(tags.length >= 1, 'expected shared-tag in suggestions');
  });

  // 6. returns empty array for query shorter than 2 chars
  await test('returns empty for single-char query', async () => {
    const r = await suggest('a');
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.body, []);
  });

  // 7. returns empty array for empty query
  await test('returns empty for empty query', async () => {
    const r = await suggest('');
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.body, []);
  });

  // 8. result count capped at 8
  await test('results capped at 8 items', async () => {
    const r = await suggest(uid);
    assert.ok(r.body.length <= 8, `expected <=8 results, got ${r.body.length}`);
  });

  // 9. no duplicate titles in results
  await test('no duplicate labels in results', async () => {
    const r = await suggest(uid);
    const labels = r.body.map(x => x.label);
    const unique = new Set(labels);
    assert.strictEqual(unique.size, labels.length, 'expected no duplicate labels');
  });

  // 10. dashboard HTML has suggest functions and dropdown
  await test('dashboard HTML has suggest UI and functions', async () => {
    const r = await new Promise((resolve, reject) => {
      const o = http.request({ hostname:'127.0.0.1', port:7749, path:'/', method:'GET' }, res => {
        let raw = ''; res.on('data', c => raw += c); res.on('end', () => resolve(raw));
      });
      o.on('error', reject); o.end();
    });
    assert.ok(r.includes('srch-sug'),       'expected srch-sug dropdown');
    assert.ok(r.includes('suggestDebounce'), 'expected suggestDebounce function');
    assert.ok(r.includes('showSuggest'),     'expected showSuggest function');
    assert.ok(r.includes('pickSuggest'),     'expected pickSuggest function');
    assert.ok(r.includes('suggestNav'),      'expected suggestNav function');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
