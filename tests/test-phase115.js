'use strict';
const assert = require('assert');
const http   = require('http');
const path   = require('path');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p115-${Date.now()}.db`);

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

  console.log('\nPhase 115 — Memory Flag (Needs Review)\n');

  const { body: m1 } = await req('POST', '/api/memories', { title: 'ToFlag', content: 'flag this memory', memory_type: 'core' });
  const { body: m2 } = await req('POST', '/api/memories', { title: 'NoFlag', content: 'do not flag this', memory_type: 'core' });

  // 1. flag endpoint returns 200
  await test('POST /flag returns 200', async () => {
    const { status } = await req('POST', `/api/memories/${m1.id}/flag`);
    assert.strictEqual(status, 200);
  });

  // 2. flagged memory has needs_review = 1
  await test('flagged memory has needs_review 1', async () => {
    const { body } = await req('GET', `/api/memories/${m1.id}`);
    assert.strictEqual(body.needs_review, 1);
  });

  // 3. flagging again toggles back to 0
  await test('second flag call toggles back to 0', async () => {
    await req('POST', `/api/memories/${m1.id}/flag`);
    const { body } = await req('GET', `/api/memories/${m1.id}`);
    assert.strictEqual(body.needs_review, 0);
  });

  // 4. flag and check filter — flag m1 again
  await test('flagged=1 filter returns flagged memories', async () => {
    await req('POST', `/api/memories/${m1.id}/flag`); // flag it
    const { body } = await req('GET', '/api/memories?flagged=1&limit=1000');
    assert.ok(Array.isArray(body), 'expected array');
    assert.ok(body.some(m => m.id === m1.id), 'flagged memory should appear in filter');
  });

  // 5. unflagged memory absent from flagged filter
  await test('unflagged memory absent from flagged filter', async () => {
    const { body } = await req('GET', '/api/memories?flagged=1&limit=1000');
    assert.ok(!body.some(m => m.id === m2.id), 'unflagged memory should not appear in flagged filter');
  });

  // 6. flagging non-existent id returns 404
  await test('flagging non-existent id returns 404', async () => {
    const { status } = await req('POST', '/api/memories/nonexistent-xyz/flag');
    assert.strictEqual(status, 404);
  });

  // 7. unflag and confirm removed from filter
  await test('unflagging removes from flagged filter', async () => {
    await req('POST', `/api/memories/${m1.id}/flag`); // unflag
    const { body } = await req('GET', '/api/memories?flagged=1&limit=1000');
    assert.ok(!body.some(m => m.id === m1.id), 'unflagged memory should not appear in flagged filter');
  });

  // 8. newly created memory has needs_review 0 by default
  await test('new memory defaults to needs_review 0', async () => {
    const { body: m3 } = await req('POST', '/api/memories', { title: 'Fresh', content: 'fresh memory content', memory_type: 'core' });
    assert.strictEqual(m3.needs_review, 0);
  });

  const html = (await req('GET', '/')).body;

  // 9. HTML has flagMem function
  await test('HTML has flagMem function', async () => {
    assert.ok(html.includes('flagMem'), 'expected flagMem in HTML');
  });

  // 10. HTML has mflagged checkbox
  await test('HTML has mflagged checkbox', async () => {
    assert.ok(html.includes('mflagged'), 'expected mflagged in HTML');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
