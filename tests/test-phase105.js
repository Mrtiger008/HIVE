'use strict';
const assert = require('assert');
const http   = require('http');
const path   = require('path');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p105-${Date.now()}.db`);

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

  console.log('\nPhase 105 — Orphan Memories Filter\n');

  // Seed: 2 memories with no tags, 2 with tags
  const { body: noTag1 } = await req('POST', '/api/memories', { title: 'NoTagA', content: 'no tag content a', memory_type: 'core' });
  const { body: noTag2 } = await req('POST', '/api/memories', { title: 'NoTagB', content: 'no tag content b', memory_type: 'core' });
  const { body: tagged1 } = await req('POST', '/api/memories', { title: 'TaggedA', content: 'tagged content a', memory_type: 'core', tags: ['alpha'] });
  const { body: tagged2 } = await req('POST', '/api/memories', { title: 'TaggedB', content: 'tagged content b', memory_type: 'core', tags: ['beta','gamma'] });

  // 1. notag=1 returns 200
  await test('notag=1 returns 200', async () => {
    const { status } = await req('GET', '/api/memories?notag=1&limit=100');
    assert.strictEqual(status, 200);
  });

  // 2. notag=1 returns array
  await test('notag=1 returns array', async () => {
    const { body } = await req('GET', '/api/memories?notag=1&limit=100');
    assert.ok(Array.isArray(body));
  });

  // 3. noTag1 appears in notag filter
  await test('untagged memory appears in notag filter', async () => {
    const { body } = await req('GET', '/api/memories?notag=1&limit=1000');
    assert.ok(body.some(m => m.id === noTag1.id), 'noTag1 should appear');
  });

  // 4. noTag2 also appears in notag filter
  await test('second untagged memory also appears', async () => {
    const { body } = await req('GET', '/api/memories?notag=1&limit=1000');
    assert.ok(body.some(m => m.id === noTag2.id), 'noTag2 should appear');
  });

  // 5. tagged memory not in notag filter
  await test('tagged memory absent from notag filter', async () => {
    const { body } = await req('GET', '/api/memories?notag=1&limit=1000');
    assert.ok(!body.some(m => m.id === tagged1.id), 'tagged1 should not appear');
  });

  // 6. multi-tagged memory not in notag filter
  await test('multi-tagged memory absent from notag filter', async () => {
    const { body } = await req('GET', '/api/memories?notag=1&limit=1000');
    assert.ok(!body.some(m => m.id === tagged2.id), 'tagged2 should not appear');
  });

  // 7. all results in notag filter have empty tags
  await test('all notag results have no tags', async () => {
    const { body } = await req('GET', '/api/memories?notag=1&limit=1000');
    for (const m of body) {
      assert.ok(!m.tags || m.tags.length === 0, `memory ${m.id} has tags but appeared in notag filter`);
    }
  });

  // 8. notag can combine with type filter
  await test('notag filter combines with type filter', async () => {
    const { body } = await req('GET', '/api/memories?notag=1&type=core&limit=1000');
    assert.ok(Array.isArray(body));
    for (const m of body) {
      assert.ok(!m.tags || m.tags.length === 0, 'all results should have no tags');
      assert.strictEqual(m.memory_type, 'core');
    }
  });

  const html = (await req('GET', '/')).body;

  // 9. HTML has mnotag checkbox
  await test('HTML has mnotag checkbox', async () => {
    assert.ok(html.includes('mnotag'), 'expected mnotag checkbox in HTML');
  });

  // 10. HTML passes notag param to API
  await test('HTML wires mnotag to notag param', async () => {
    assert.ok(html.includes('notag=1'), 'expected notag=1 in HTML query builder');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
