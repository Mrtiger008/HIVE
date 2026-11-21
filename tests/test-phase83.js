'use strict';
const assert = require('assert');
const http   = require('http');
const path   = require('path');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p83-${Date.now()}.db`);

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

  console.log('\nPhase 83 — Memory Share Card\n');

  const html = (await req('GET', '/')).body;

  // 1. HTML has share-modal element
  await test('HTML has share-modal element', async () => {
    assert.ok(html.includes('id="share-modal"'), 'expected #share-modal in HTML');
  });

  // 2. HTML has share-ta textarea
  await test('HTML has share-ta textarea', async () => {
    assert.ok(html.includes('id="share-ta"'), 'expected #share-ta textarea in HTML');
  });

  // 3. HTML has shareCard function
  await test('HTML has shareCard function', async () => {
    assert.ok(html.includes('async function shareCard('), 'expected shareCard function');
  });

  // 4. HTML has shareCardCopy function
  await test('HTML has shareCardCopy function', async () => {
    assert.ok(html.includes('function shareCardCopy('), 'expected shareCardCopy function');
  });

  // 5. card() HTML has share button
  await test('memory card has share button', async () => {
    assert.ok(html.includes("onclick=\"shareCard('"), 'expected shareCard onclick in card HTML');
  });

  // 6. shareCard fetches from /api/memories/:id
  await test('shareCard uses /api/memories/:id', async () => {
    assert.ok(html.includes('/api/memories/${id}') || html.includes('`/api/memories/${id}`') || html.includes("api(`/api/memories/"), 'expected /api/memories/:id fetch in shareCard');
  });

  // 7. share text includes title separator
  await test('shareCard formats with separator line', async () => {
    assert.ok(html.includes('─'.repeat(10)), 'expected separator dashes in share format');
  });

  // 8. share text includes "from HIVE"
  await test('shareCard includes HIVE attribution', async () => {
    assert.ok(html.includes('from HIVE'), 'expected HIVE attribution in share text');
  });

  // 9. share-copy-btn exists
  await test('HTML has share-copy-btn button', async () => {
    assert.ok(html.includes('id="share-copy-btn"'), 'expected share-copy-btn in HTML');
  });

  // 10. /api/memories/:id still works (no regression)
  await test('GET /api/memories still returns 200', async () => {
    const { status } = await req('GET', '/api/memories?limit=1');
    assert.strictEqual(status, 200);
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
