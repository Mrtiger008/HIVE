'use strict';
const assert = require('assert');
const http   = require('http');
const path   = require('path');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p82-${Date.now()}.db`);

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

  console.log('\nPhase 82 — Reading Time Filter\n');

  // Seed: quick (<100 words), medium (100-400), long (>400)
  const shortContent = 'short '.repeat(10).trim();              // 10 words
  const medContent   = 'word '.repeat(200).trim();              // 200 words
  const longContent  = 'word '.repeat(500).trim();              // 500 words

  const { body: mShort }  = await req('POST', '/api/memories', { title: 'Quick read', content: shortContent, memory_type: 'core' });
  const { body: mMedium } = await req('POST', '/api/memories', { title: 'Medium read', content: medContent, memory_type: 'core' });
  const { body: mLong }   = await req('POST', '/api/memories', { title: 'Long read', content: longContent, memory_type: 'core' });

  // 1. read_time=quick returns short memory
  await test('read_time=quick returns short memory', async () => {
    const { body } = await req('GET', '/api/memories?read_time=quick&limit=1000');
    assert.ok(body.some(m => m.id === mShort.id), 'expected short memory in quick results');
  });

  // 2. read_time=quick excludes long memory
  await test('read_time=quick excludes long memory', async () => {
    const { body } = await req('GET', '/api/memories?read_time=quick&limit=1000');
    assert.ok(!body.some(m => m.id === mLong.id), 'long memory should not appear in quick results');
  });

  // 3. read_time=medium returns medium memory
  await test('read_time=medium returns medium memory', async () => {
    const { body } = await req('GET', '/api/memories?read_time=medium&limit=1000');
    assert.ok(body.some(m => m.id === mMedium.id), 'expected medium memory in medium results');
  });

  // 4. read_time=medium excludes short and long
  await test('read_time=medium excludes short and long', async () => {
    const { body } = await req('GET', '/api/memories?read_time=medium&limit=1000');
    assert.ok(!body.some(m => m.id === mShort.id), 'short should not appear in medium');
    assert.ok(!body.some(m => m.id === mLong.id), 'long should not appear in medium');
  });

  // 5. read_time=long returns long memory
  await test('read_time=long returns long memory', async () => {
    const { body } = await req('GET', '/api/memories?read_time=long&limit=1000');
    assert.ok(body.some(m => m.id === mLong.id), 'expected long memory in long results');
  });

  // 6. read_time=long excludes short memory
  await test('read_time=long excludes short memory', async () => {
    const { body } = await req('GET', '/api/memories?read_time=long&limit=1000');
    assert.ok(!body.some(m => m.id === mShort.id), 'short should not appear in long results');
  });

  // 7. No read_time returns all three
  await test('no read_time filter returns all memories', async () => {
    const { body } = await req('GET', '/api/memories?limit=1000');
    const ids = body.map(m => m.id);
    assert.ok(ids.includes(mShort.id) && ids.includes(mMedium.id) && ids.includes(mLong.id));
  });

  // 8. read_time=quick returns 200
  await test('GET /api/memories?read_time=quick returns 200', async () => {
    const { status } = await req('GET', '/api/memories?read_time=quick');
    assert.strictEqual(status, 200);
  });

  // 9. HTML has mread select
  await test('HTML has mread select element', async () => {
    const { body: html } = await req('GET', '/');
    assert.ok(html.includes('id="mread"'), 'expected #mread select in HTML');
  });

  // 10. HTML has reading time options
  await test('HTML has quick/medium/long options', async () => {
    const { body: html } = await req('GET', '/');
    assert.ok(html.includes('value="quick"') && html.includes('value="medium"') && html.includes('value="long"'));
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
