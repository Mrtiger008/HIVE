'use strict';
const assert = require('assert');
const http   = require('http');
const path   = require('path');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p117-${Date.now()}.db`);

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

  console.log('\nPhase 117 — Compact Memory List View\n');

  // Server still serves normally (no backend change)
  const { status, body: html } = await req('GET', '/');

  // 1. server still returns 200
  await test('GET / still returns 200', async () => {
    assert.strictEqual(status, 200);
  });

  // 2. HTML has compact-toggle button
  await test('HTML has compact-toggle button', async () => {
    assert.ok(html.includes('compact-toggle'), 'expected compact-toggle button id in HTML');
  });

  // 3. HTML has toggleCompactView function
  await test('HTML has toggleCompactView function', async () => {
    assert.ok(html.includes('toggleCompactView'), 'expected toggleCompactView function in HTML');
  });

  // 4. HTML has compact CSS class rule
  await test('HTML has compact CSS rule for #ml', async () => {
    assert.ok(html.includes('#ml.compact'), 'expected #ml.compact CSS in HTML');
  });

  // 5. compact CSS hides .cc (content preview)
  await test('compact CSS targets .cc to hide content', async () => {
    assert.ok(html.includes('#ml.compact .cc'), 'expected #ml.compact .cc in CSS');
  });

  // 6. toggle button initial label is Compact
  await test('toggle button shows Compact initially', async () => {
    assert.ok(html.includes('⊟ Compact'), 'expected Compact label on button');
  });

  // 7. HTML references localStorage for persistence
  await test('HTML uses localStorage for compact preference', async () => {
    assert.ok(html.includes("'hive-compact'") || html.includes('"hive-compact"'),
      'expected hive-compact localStorage key');
  });

  // 8. memories API still works normally
  await test('GET /api/memories still returns 200', async () => {
    const { status } = await req('GET', '/api/memories?limit=5');
    assert.strictEqual(status, 200);
  });

  // 9. HTML has Cards label for toggle-off state
  await test('HTML has Cards label for expanded state', async () => {
    assert.ok(html.includes('⊞ Cards'), 'expected Cards label in toggleCompactView function');
  });

  // 10. HTML has applyHealthFilter (phase 116 not broken)
  await test('applyHealthFilter still present (phase 116 not broken)', async () => {
    assert.ok(html.includes('applyHealthFilter'), 'expected applyHealthFilter in HTML');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
