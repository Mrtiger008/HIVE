'use strict';
const assert = require('assert');
const http   = require('http');
const path   = require('path');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p66-${Date.now()}.db`);

function req(method, pathname) {
  return new Promise((resolve, reject) => {
    const opts = { hostname: '127.0.0.1', port: 7749, path: pathname, method,
                   headers: { 'X-Hive-Local': '1' } };
    const r = http.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => { let b; try { b = JSON.parse(raw); } catch { b = raw; } resolve({ status: res.statusCode, body: b }); });
    });
    r.on('error', reject); r.end();
  });
}

async function run() {
  let passed = 0;
  const total = 10;
  async function test(name, fn) {
    try { await fn(); console.log(`  ✓ ${name}`); passed++; }
    catch (e) { console.log(`  ✗ ${name}: ${e.message}`); }
  }

  console.log('\nPhase 66 — Keyboard Shortcut Cheatsheet\n');

  const { body: api } = await req('GET', '/api/shortcuts');
  const html = (await req('GET', '/')).body;

  // 1. GET /api/shortcuts returns 200 with shortcuts array
  await test('GET /api/shortcuts returns shortcuts array', async () => {
    assert.ok(api.shortcuts, 'expected shortcuts key');
    assert.ok(Array.isArray(api.shortcuts), 'expected array');
    assert.ok(api.shortcuts.length >= 6, 'expected at least 6 shortcuts');
  });

  // 2. each shortcut has key and description
  await test('each shortcut has key and description fields', async () => {
    for (const s of api.shortcuts) {
      assert.ok(s.key,         `missing key in: ${JSON.stringify(s)}`);
      assert.ok(s.description, `missing description in: ${JSON.stringify(s)}`);
    }
  });

  // 3. / shortcut is present
  await test('/ shortcut is present (focus search)', async () => {
    assert.ok(api.shortcuts.some(s => s.key === '/'), 'missing / shortcut');
  });

  // 4. n shortcut is present
  await test('n shortcut is present (new memory)', async () => {
    assert.ok(api.shortcuts.some(s => s.key === 'n'), 'missing n shortcut');
  });

  // 5. q shortcut is present (quick capture)
  await test('q shortcut is present (quick capture)', async () => {
    assert.ok(api.shortcuts.some(s => s.key === 'q'), 'missing q shortcut');
  });

  // 6. ? shortcut is present (toggle help)
  await test('? shortcut is present (toggle help)', async () => {
    assert.ok(api.shortcuts.some(s => s.key === '?'), 'missing ? shortcut');
  });

  // 7. dashboard HTML has #kb-help overlay
  await test('dashboard HTML has #kb-help overlay element', async () => {
    assert.ok(html.includes('kb-help'), 'expected kb-help in HTML');
  });

  // 8. dashboard has toggleHelp function
  await test('dashboard HTML has toggleHelp function', async () => {
    assert.ok(html.includes('toggleHelp'), 'expected toggleHelp in HTML');
  });

  // 9. dashboard has ? nav button that calls toggleHelp
  await test('nav has ? button calling toggleHelp()', async () => {
    assert.ok(html.includes('onclick="toggleHelp()"'), 'expected ? button with toggleHelp onclick');
  });

  // 10. overlay table is populated from API (kb-table element present)
  await test('overlay has #kb-table element for dynamic population', async () => {
    assert.ok(html.includes('kb-table'), 'expected kb-table in HTML');
    assert.ok(html.includes('/api/shortcuts'), 'expected /api/shortcuts fetch in HTML');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
