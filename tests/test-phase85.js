'use strict';
const assert = require('assert');
const http   = require('http');
const path   = require('path');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p85-${Date.now()}.db`);

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

  console.log('\nPhase 85 — Memory Color Theme\n');

  const html = (await req('GET', '/')).body;

  // 1. HTML card label select has purple option
  await test('card label select has purple option', async () => {
    assert.ok(html.includes('value="purple"'), 'expected purple option');
  });

  // 2. HTML card label select has orange option
  await test('card label select has orange option', async () => {
    assert.ok(html.includes('value="orange"'), 'expected orange option');
  });

  // 3. HTML card label select has teal option
  await test('card label select has teal option', async () => {
    assert.ok(html.includes('value="teal"'), 'expected teal option');
  });

  // 4. HTML card label select has pink option
  await test('card label select has pink option', async () => {
    assert.ok(html.includes('value="pink"'), 'expected pink option');
  });

  // 5. LCOL map includes purple color
  await test('LCOL includes purple color', async () => {
    assert.ok(html.includes("purple:'#d2a8ff'") || html.includes('purple:"#d2a8ff"'), 'expected purple in LCOL');
  });

  // 6. LCOL map includes orange color
  await test('LCOL includes orange color', async () => {
    assert.ok(html.includes("orange:'#ffa657'") || html.includes('orange:"#ffa657"'), 'expected orange in LCOL');
  });

  // 7. memories filter has purple option
  await test('memories filter has purple label option', async () => {
    // mlabel select should have purple
    assert.ok(html.includes('value="purple"'), 'expected purple in mlabel filter');
  });

  // 8. bulk-label select has orange option
  await test('bulk-label select has orange option', async () => {
    // multiple value="orange" should appear (card + mlabel + bulk-label)
    const count = (html.match(/value="orange"/g) || []).length;
    assert.ok(count >= 2, `expected orange in multiple selects, got ${count}`);
  });

  // 9. set purple label via API and fetch it back
  await test('can set and read purple label', async () => {
    const { body: m } = await req('POST', '/api/memories', { title: 'Color test', content: 'x', memory_type: 'core' });
    await req('PUT', `/api/memories/${m.id}`, { label: 'purple' });
    const { body: updated } = await req('GET', `/api/memories/${m.id}`);
    assert.strictEqual(updated.label, 'purple');
  });

  // 10. filter by purple label returns the memory
  await test('filter by purple label returns memory', async () => {
    // create a fresh purple memory
    const { body: m } = await req('POST', '/api/memories', { title: 'Purple mem', content: 'y', memory_type: 'core' });
    await req('PUT', `/api/memories/${m.id}`, { label: 'purple' });
    const { body: results } = await req('GET', '/api/memories?label=purple&limit=1000');
    assert.ok(results.some(r => r.id === m.id), 'expected purple memory in filtered results');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
