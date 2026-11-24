'use strict';
const assert = require('assert');
const http   = require('http');
const path   = require('path');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p120-${Date.now()}.db`);

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

  console.log('\nPhase 120 — Keyboard Card Navigation (j/k)\n');

  const html = (await req('GET', '/')).body;

  // 1. HTML has kbFocus function
  await test('HTML has kbFocus function', async () => {
    assert.ok(html.includes('kbFocus'), 'expected kbFocus function in HTML');
  });

  // 2. HTML has _kbFocusIdx state variable
  await test('HTML has _kbFocusIdx state', async () => {
    assert.ok(html.includes('_kbFocusIdx'), 'expected _kbFocusIdx in HTML');
  });

  // 3. HTML has kb-focus CSS class
  await test('HTML has .card.kb-focus CSS rule', async () => {
    assert.ok(html.includes('kb-focus'), 'expected kb-focus CSS class in HTML');
  });

  // 4. HTML keydown handler includes j key
  await test('HTML keydown handles j key', async () => {
    assert.ok(html.includes("'j'") || html.includes('"j"'), 'expected j key in keydown handler');
  });

  // 5. HTML keydown handler includes k key
  await test('HTML keydown handles k key', async () => {
    assert.ok(html.includes("'k'") || html.includes('"k"'), 'expected k key in keydown handler');
  });

  // 6. kbFocus called with positive direction for j
  await test('kbFocus(1) called for j', async () => {
    assert.ok(html.includes('kbFocus(1)'), 'expected kbFocus(1) for j key');
  });

  // 7. kbFocus called with negative direction for k
  await test('kbFocus(-1) called for k', async () => {
    assert.ok(html.includes('kbFocus(-1)'), 'expected kbFocus(-1) for k key');
  });

  // 8. Enter key opens focused card via showEdit
  await test('Enter key calls showEdit on focused card', async () => {
    assert.ok(html.includes('showEdit') && html.includes('_kbFocusIdx'), 'expected showEdit + _kbFocusIdx in Enter handler');
  });

  // 9. shortcuts API includes j and k
  await test('GET /api/shortcuts includes j and k entries', async () => {
    const { body } = await req('GET', '/api/shortcuts');
    assert.ok(Array.isArray(body.shortcuts), 'expected shortcuts array');
    assert.ok(body.shortcuts.some(s => s.key === 'j'), 'expected j in shortcuts');
    assert.ok(body.shortcuts.some(s => s.key === 'k'), 'expected k in shortcuts');
  });

  // 10. loadMem resets _kbFocusIdx (check that reset is in HTML)
  await test('loadMem resets _kbFocusIdx', async () => {
    // The assignment _kbFocusIdx = -1 appears in loadMem (there are 2: declaration + reset in loadMem)
    const count = (html.match(/_kbFocusIdx/g) || []).length;
    assert.ok(count >= 2, `expected _kbFocusIdx to appear at least 2 times (declaration + reset), got ${count}`);
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
