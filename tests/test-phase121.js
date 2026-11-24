'use strict';
const assert = require('assert');
const http   = require('http');
const path   = require('path');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p121-${Date.now()}.db`);

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

  console.log('\nPhase 121 — Stats Drill-Down Filters\n');

  // Seed memories of different types and domains
  await req('POST', '/api/memories', { title: 'P121-Core', content: 'core type memory', memory_type: 'core', domain: 'tech' });
  await req('POST', '/api/memories', { title: 'P121-Skill', content: 'skill type memory', memory_type: 'skill', domain: 'work' });
  await req('POST', '/api/memories', { title: 'P121-Semantic', content: 'semantic type memory', memory_type: 'semantic', domain: 'tech' });

  // 1. type-dist endpoint returns 200
  await test('GET /api/stats/type-dist returns 200', async () => {
    const { status } = await req('GET', '/api/stats/type-dist');
    assert.strictEqual(status, 200);
  });

  // 2. type-dist returns array
  await test('type-dist response is an array', async () => {
    const { body } = await req('GET', '/api/stats/type-dist');
    assert.ok(Array.isArray(body), 'expected array response');
  });

  // 3. type-dist has type and count fields
  await test('type-dist rows have type and count fields', async () => {
    const { body } = await req('GET', '/api/stats/type-dist');
    assert.ok(body.length >= 1, 'expected at least one type');
    assert.ok('type' in body[0], 'expected type field');
    assert.ok('count' in body[0], 'expected count field');
  });

  // 4. type-dist reflects seeded memories
  await test('type-dist includes core and skill types from seed', async () => {
    const { body } = await req('GET', '/api/stats/type-dist');
    const types = body.map(r => r.type);
    assert.ok(types.includes('core'), 'expected core in type-dist');
    assert.ok(types.includes('skill'), 'expected skill in type-dist');
  });

  // 5. type-dist ordered by count desc
  await test('type-dist ordered by count descending', async () => {
    const { body } = await req('GET', '/api/stats/type-dist');
    for (let i = 1; i < body.length; i++) {
      assert.ok(body[i-1].count >= body[i].count, 'expected descending count order');
    }
  });

  // 6. type-dist count >= 1 for all entries
  await test('all type-dist entries have count >= 1', async () => {
    const { body } = await req('GET', '/api/stats/type-dist');
    body.forEach(r => assert.ok(r.count >= 1, `type ${r.type} has count ${r.count}`));
  });

  const html = (await req('GET', '/')).body;

  // 7. HTML has applyStatsFilter function
  await test('HTML has applyStatsFilter function', async () => {
    assert.ok(html.includes('applyStatsFilter'), 'expected applyStatsFilter in HTML');
  });

  // 8. HTML has type-dist panel
  await test('HTML has ks-type-dist panel', async () => {
    assert.ok(html.includes('ks-type-dist'), 'expected ks-type-dist panel in HTML');
  });

  // 9. HTML fetches /api/stats/type-dist
  await test('HTML fetches /api/stats/type-dist', async () => {
    assert.ok(html.includes('/api/stats/type-dist'), 'expected type-dist endpoint in HTML');
  });

  // 10. domain breakdown rows have applyStatsFilter onclick
  await test('domain breakdown rows call applyStatsFilter on click', async () => {
    // The domain breakdown tr has onclick="applyStatsFilter({domain:...})"
    assert.ok(html.includes("applyStatsFilter({domain:"), 'expected domain click-through in HTML');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
