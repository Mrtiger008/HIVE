'use strict';
const assert = require('assert');
const http   = require('http');
const path   = require('path');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p92-${Date.now()}.db`);

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

  console.log('\nPhase 92 — Memory Favorite (Star)\n');

  // Seed two memories
  const { body: m1 } = await req('POST', '/api/memories', { title: 'Star me', content: 'x', memory_type: 'core' });
  const { body: m2 } = await req('POST', '/api/memories', { title: 'Plain',   content: 'x', memory_type: 'core' });

  // 1. New memory has starred=0 by default
  await test('new memory has starred=0 by default', async () => {
    const { body } = await req('GET', '/api/memories/' + m1.id);
    assert.strictEqual(body.starred, 0);
  });

  // 2. POST /star returns 200 and starred=1
  await test('POST /star sets starred=1', async () => {
    const { status, body } = await req('POST', '/api/memories/' + m1.id + '/star');
    assert.strictEqual(status, 200);
    assert.strictEqual(body.starred, 1);
  });

  // 3. GET after star confirms starred=1
  await test('GET after star confirms starred=1', async () => {
    const { body } = await req('GET', '/api/memories/' + m1.id);
    assert.strictEqual(body.starred, 1);
  });

  // 4. POST /unstar resets to starred=0
  await test('POST /unstar resets starred=0', async () => {
    const { status, body } = await req('POST', '/api/memories/' + m1.id + '/unstar');
    assert.strictEqual(status, 200);
    assert.strictEqual(body.starred, 0);
  });

  // 5. starred=1 filter returns only starred memories
  await test('starred=1 filter returns only starred memories', async () => {
    // star m1, leave m2 unstarred
    await req('POST', '/api/memories/' + m1.id + '/star');
    const { body } = await req('GET', '/api/memories?starred=1&limit=1000');
    assert.ok(body.some(m => m.id === m1.id), 'should include starred memory');
    assert.ok(!body.some(m => m.id === m2.id), 'should not include unstarred memory');
  });

  // 6. No starred param returns all (including unstarred)
  await test('no starred param returns all memories', async () => {
    const { body } = await req('GET', '/api/memories?limit=1000');
    assert.ok(body.some(m => m.id === m2.id), 'should include unstarred memory');
  });

  // 7. star a non-existent id returns 404
  await test('star non-existent id returns 404', async () => {
    const { status } = await req('POST', '/api/memories/no-such-id/star');
    assert.strictEqual(status, 404);
  });

  const html = (await req('GET', '/')).body;

  // 8. HTML has mstarred checkbox
  await test('HTML has #mstarred checkbox', async () => {
    assert.ok(html.includes('id="mstarred"'), 'expected #mstarred in HTML');
  });

  // 9. HTML has toggleStar function
  await test('HTML has toggleStar function', async () => {
    assert.ok(html.includes('function toggleStar('), 'expected toggleStar in HTML');
  });

  // 10. HTML has star/unstar routes referenced
  await test('HTML references /star and /unstar routes', async () => {
    assert.ok(html.includes("'star'") && html.includes("'unstar'"), 'expected star/unstar in toggleStar');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
