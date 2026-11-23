'use strict';
const assert = require('assert');
const http   = require('http');
const path   = require('path');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p103-${Date.now()}.db`);

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

  console.log('\nPhase 103 — Random Memory Discovery\n');

  // Seed memories
  const { body: m1 } = await req('POST', '/api/memories', { title: 'Alpha', content: 'alpha content here', memory_type: 'core',     tags: ['a'] });
  const { body: m2 } = await req('POST', '/api/memories', { title: 'Beta',  content: 'beta content here',  memory_type: 'semantic', tags: ['b'] });
  const { body: m3 } = await req('POST', '/api/memories', { title: 'Gamma', content: 'gamma content here', memory_type: 'domain'   });

  // 1. returns 200 when memories exist
  await test('returns 200 when memories exist', async () => {
    const { status } = await req('GET', '/api/memories/random');
    assert.strictEqual(status, 200);
  });

  // 2. returns 200 when memories exist
  await test('returns 200 when memories exist', async () => {
    const { status } = await req('GET', '/api/memories/random');
    assert.strictEqual(status, 200);
  });

  // 3. returns a memory object
  await test('returns a memory object with id and title', async () => {
    const { body } = await req('GET', '/api/memories/random');
    assert.ok(body.id, 'expected id field');
    assert.ok(body.title, 'expected title field');
  });

  // 4. returned memory has content
  await test('returned memory has content', async () => {
    const { body } = await req('GET', '/api/memories/random');
    assert.ok(typeof body.content === 'string', 'expected content string');
  });

  // 5. returned memory can be fetched by id (proves it's a real memory)
  await test('returned memory is fetchable by id', async () => {
    const { body } = await req('GET', '/api/memories/random');
    const { body: fetched, status } = await req('GET', `/api/memories/${body.id}`);
    assert.strictEqual(status, 200, 'GET by id should return 200');
    assert.strictEqual(fetched.id, body.id, 'fetched id should match');
  });

  // 6. returned memory has status = active
  await test('returned memory has status active', async () => {
    const { body } = await req('GET', '/api/memories/random');
    assert.strictEqual(body.status, 'active');
  });

  // 7. archived memory not returned
  await test('archived memory never returned', async () => {
    // create and archive a unique memory, then verify only non-archived are returned
    const { body: ma } = await req('POST', '/api/memories', { title: 'ArchivedOnly', content: 'archive me please', memory_type: 'core' });
    await req('DELETE', `/api/memories/${ma.id}`);
    // call random 10 times — should never get the archived one
    for (let i = 0; i < 10; i++) {
      const { body } = await req('GET', '/api/memories/random');
      assert.ok(body.id !== ma.id, 'archived memory should not be returned');
    }
  });

  // 8. returns different memories across multiple calls (non-deterministic — with 3 memories,
  //    calling 20 times should hit at least 2 distinct IDs)
  await test('returns varied results across multiple calls', async () => {
    const seen = new Set();
    for (let i = 0; i < 20; i++) {
      const { body } = await req('GET', '/api/memories/random');
      seen.add(body.id);
    }
    assert.ok(seen.size >= 2, `expected >= 2 distinct ids across 20 calls, got ${seen.size}`);
  });

  const html = (await req('GET', '/')).body;

  // 9. HTML references showRandom function
  await test('HTML has showRandom function', async () => {
    assert.ok(html.includes('showRandom'), 'expected showRandom in HTML');
  });

  // 10. HTML has random-modal element
  await test('HTML has random-modal element', async () => {
    assert.ok(html.includes('random-modal'), 'expected random-modal div in HTML');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
