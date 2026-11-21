'use strict';
const assert = require('assert');
const http   = require('http');
const path   = require('path');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p80-${Date.now()}.db`);

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

  console.log('\nPhase 80 — Memory Highlight on Load\n');

  const html = (await req('GET', '/')).body;

  // 1. HTML has highlightCard function
  await test('HTML has highlightCard function', async () => {
    assert.ok(html.includes('function highlightCard('), 'expected highlightCard function');
  });

  // 2. highlightCard uses scrollIntoView
  await test('highlightCard calls scrollIntoView', async () => {
    assert.ok(html.includes('scrollIntoView'), 'expected scrollIntoView call');
  });

  // 3. highlightCard sets amber outline
  await test('highlightCard applies amber outline', async () => {
    assert.ok(html.includes('#d29922'), 'expected amber color in highlight');
  });

  // 4. highlightCard clears outline after timeout
  await test('highlightCard clears outline after delay', async () => {
    assert.ok(html.includes("el.style.outline = ''"), 'expected outline clear after timeout');
  });

  // 5. HTML has checkHashHighlight function
  await test('HTML has checkHashHighlight function', async () => {
    assert.ok(html.includes('async function checkHashHighlight('), 'expected checkHashHighlight function');
  });

  // 6. checkHashHighlight reads location.hash
  await test('checkHashHighlight reads location.hash', async () => {
    assert.ok(html.includes('location.hash'), 'expected location.hash usage');
  });

  // 7. checkHashHighlight switches to memories tab
  await test('checkHashHighlight switches to memories tab', async () => {
    assert.ok(html.includes("'memories'") && html.includes('memNavBtn'), 'expected memories tab switch');
  });

  // 8. page init calls checkHashHighlight if hash present
  await test('page init calls checkHashHighlight when hash present', async () => {
    assert.ok(html.includes('if (location.hash) checkHashHighlight()'), 'expected init hash check');
  });

  // 9. hashchange event listener added
  await test('hashchange event listener wired up', async () => {
    assert.ok(html.includes("'hashchange'"), 'expected hashchange listener');
  });

  // 10. memories API still works (no regression)
  await test('GET /api/memories still returns 200', async () => {
    const { status } = await req('GET', '/api/memories?limit=5');
    assert.strictEqual(status, 200);
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
