'use strict';
const assert = require('assert');
const http   = require('http');
const path   = require('path');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p78-${Date.now()}.db`);

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

  console.log('\nPhase 78 — Memory Copy Link\n');

  const html = (await req('GET', '/')).body;

  // 1. HTML has copyLink function
  await test('HTML has copyLink function', async () => {
    assert.ok(html.includes('function copyLink('), 'expected copyLink function');
  });

  // 2. copyLink uses navigator.clipboard.writeText
  await test('copyLink uses navigator.clipboard.writeText', async () => {
    assert.ok(html.includes('navigator.clipboard.writeText'), 'expected clipboard API usage');
  });

  // 3. copyLink builds URL with location.origin + /#
  await test('copyLink builds URL with location.origin + /#', async () => {
    assert.ok(html.includes("location.origin + '/#'"), 'expected URL built from origin + /#');
  });

  // 4. card has copy link button with onclick=copyLink
  await test('card has 🔗 copy button with copyLink onclick', async () => {
    assert.ok(html.includes("onclick=\"copyLink('"), 'expected copyLink button in card');
  });

  // 5. copy button has id="cl-${m.id}" for feedback targeting
  await test('copy button has id="cl-${m.id}" for feedback', async () => {
    assert.ok(html.includes('id="cl-'), 'expected cl-{id} button id');
  });

  // 6. copyLink shows "✓ copied" feedback
  await test('copyLink shows checkmark feedback on success', async () => {
    assert.ok(html.includes('✓ copied'), 'expected copied feedback text');
  });

  // 7. copyLink resets button text after timeout
  await test('copyLink resets button text after delay', async () => {
    assert.ok(html.includes('setTimeout'), 'expected setTimeout for reset');
  });

  // 8. copy button title describes the action
  await test('copy button has descriptive title', async () => {
    assert.ok(html.includes('Copy link to this memory'), 'expected title on copy button');
  });

  // 9. memories API still returns 200 (no regression)
  await test('GET /api/memories still returns 200', async () => {
    const { status } = await req('GET', '/api/memories?limit=10');
    assert.strictEqual(status, 200);
  });

  // 10. copy button uses clipboard catch (error handling)
  await test('copyLink has .catch() for clipboard failure', async () => {
    assert.ok(html.includes('.catch('), 'expected .catch() on clipboard promise');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
