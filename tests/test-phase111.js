'use strict';
const assert = require('assert');
const http   = require('http');
const path   = require('path');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p111-${Date.now()}.db`);

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

  console.log('\nPhase 111 — Label Distribution Stats\n');

  // Seed labelled memories
  await req('POST', '/api/memories', { title: 'RedA',    content: 'red a content',    memory_type: 'core',     label: 'red'    });
  await req('POST', '/api/memories', { title: 'RedB',    content: 'red b content',    memory_type: 'core',     label: 'red'    });
  await req('POST', '/api/memories', { title: 'GreenA',  content: 'green a content',  memory_type: 'semantic', label: 'green'  });
  await req('POST', '/api/memories', { title: 'NoLabel', content: 'no label content', memory_type: 'core'                     });

  // 1. endpoint returns 200
  await test('GET /api/stats/label-dist returns 200', async () => {
    const { status } = await req('GET', '/api/stats/label-dist');
    assert.strictEqual(status, 200);
  });

  // 2. returns array
  await test('response is an array', async () => {
    const { body } = await req('GET', '/api/stats/label-dist');
    assert.ok(Array.isArray(body), 'expected array');
  });

  // 3. each item has label and count
  await test('each item has label and count fields', async () => {
    const { body } = await req('GET', '/api/stats/label-dist');
    for (const r of body) {
      assert.ok('label' in r, 'expected label field');
      assert.ok('count' in r && typeof r.count === 'number', 'expected numeric count');
    }
  });

  // 4. red label has count >= 2
  await test('red label has count >= 2', async () => {
    const { body } = await req('GET', '/api/stats/label-dist');
    const red = body.find(r => r.label === 'red');
    assert.ok(red, 'red label should appear');
    assert.ok(red.count >= 2, `expected >= 2, got ${red.count}`);
  });

  // 5. green label has count >= 1
  await test('green label has count >= 1', async () => {
    const { body } = await req('GET', '/api/stats/label-dist');
    const green = body.find(r => r.label === 'green');
    assert.ok(green, 'green label should appear');
    assert.ok(green.count >= 1, `expected >= 1, got ${green.count}`);
  });

  // 6. none bucket appears (unlabelled memories exist)
  await test('none bucket appears for unlabelled memories', async () => {
    const { body } = await req('GET', '/api/stats/label-dist');
    const none = body.find(r => r.label === 'none');
    assert.ok(none, 'none bucket should appear');
    assert.ok(none.count >= 1, `expected >= 1 unlabelled, got ${none.count}`);
  });

  // 7. all counts are non-negative
  await test('all counts are non-negative', async () => {
    const { body } = await req('GET', '/api/stats/label-dist');
    for (const r of body) {
      assert.ok(r.count >= 0, `label ${r.label} has negative count`);
    }
  });

  // 8. labels with 0 count are excluded
  await test('zero-count labels excluded from results', async () => {
    const { body } = await req('GET', '/api/stats/label-dist');
    for (const r of body) {
      assert.ok(r.count > 0, `label ${r.label} should not appear with count 0`);
    }
  });

  const html = (await req('GET', '/')).body;

  // 9. HTML has ks-label-dist element
  await test('HTML has ks-label-dist element', async () => {
    assert.ok(html.includes('ks-label-dist'), 'expected ks-label-dist in HTML');
  });

  // 10. HTML fetches /api/stats/label-dist
  await test('HTML fetches /api/stats/label-dist', async () => {
    assert.ok(html.includes('/api/stats/label-dist'), 'expected label-dist endpoint in HTML');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
