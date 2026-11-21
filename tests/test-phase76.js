'use strict';
const assert = require('assert');
const http   = require('http');
const path   = require('path');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p76-${Date.now()}.db`);

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

  console.log('\nPhase 76 — Keyboard Navigation for Tag Suggestions\n');

  const html = (await req('GET', '/')).body;

  // 1. nm-tg input has onkeydown handler
  await test('nm-tg input has onkeydown=tagSuggestKey', async () => {
    assert.ok(html.includes('onkeydown="tagSuggestKey(event)"'), 'expected onkeydown handler on nm-tg');
  });

  // 2. tagSuggestKey function exists
  await test('tagSuggestKey function defined', async () => {
    assert.ok(html.includes('function tagSuggestKey('), 'expected tagSuggestKey function');
  });

  // 3. tagSuggestKey handles ArrowDown
  await test('tagSuggestKey handles ArrowDown', async () => {
    assert.ok(html.includes("'ArrowDown'"), 'expected ArrowDown handling');
  });

  // 4. tagSuggestKey handles ArrowUp
  await test('tagSuggestKey handles ArrowUp', async () => {
    assert.ok(html.includes("'ArrowUp'"), 'expected ArrowUp handling');
  });

  // 5. tagSuggestKey handles Enter
  await test('tagSuggestKey handles Enter with index check', async () => {
    assert.ok(html.includes("'Enter' && _sugIdx >= 0"), 'expected Enter+index guard');
  });

  // 6. tagSuggestKey handles Escape
  await test('tagSuggestKey handles Escape', async () => {
    assert.ok(html.includes("'Escape'"), 'expected Escape handling');
  });

  // 7. _sugIdx variable declared
  await test('_sugIdx variable declared', async () => {
    assert.ok(html.includes('let _sugIdx'), 'expected _sugIdx variable');
  });

  // 8. suggestion rows have data-tag attribute
  await test('suggestion rows render with data-tag attribute', async () => {
    assert.ok(html.includes('data-tag='), 'expected data-tag on suggestion rows');
  });

  // 9. suggestion rows have data-sug-idx attribute
  await test('suggestion rows render with data-sug-idx attribute', async () => {
    assert.ok(html.includes('data-sug-idx='), 'expected data-sug-idx on suggestion rows');
  });

  // 10. _sugHover function exists for highlight management
  await test('_sugHover function defined for highlight management', async () => {
    assert.ok(html.includes('function _sugHover('), 'expected _sugHover function');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
