'use strict';
const assert = require('assert');
const http   = require('http');
const path   = require('path');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p116-${Date.now()}.db`);

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

  console.log('\nPhase 116 — Knowledge Health Summary\n');

  // Seed: one flagged, one untagged (no tags), one with tags
  const { body: m1 } = await req('POST', '/api/memories', { title: 'FlagMe', content: 'flag this for health', memory_type: 'core', tags: ['important'] });
  await req('POST', `/api/memories/${m1.id}/flag`);
  await req('POST', '/api/memories', { title: 'NoTagMem', content: 'memory without tags', memory_type: 'core' });
  await req('POST', '/api/memories', { title: 'Tagged', content: 'memory with tags here', memory_type: 'core', tags: ['work'] });

  // 1. endpoint returns 200
  await test('GET /api/stats/health-summary returns 200', async () => {
    const { status } = await req('GET', '/api/stats/health-summary');
    assert.strictEqual(status, 200);
  });

  // 2. response has flagged, stale, untagged, expired fields
  await test('response has all 4 health fields', async () => {
    const { body } = await req('GET', '/api/stats/health-summary');
    assert.ok('flagged'  in body, 'expected flagged');
    assert.ok('stale'    in body, 'expected stale');
    assert.ok('untagged' in body, 'expected untagged');
    assert.ok('expired'  in body, 'expected expired');
  });

  // 3. all values are non-negative numbers
  await test('all values are non-negative numbers', async () => {
    const { body } = await req('GET', '/api/stats/health-summary');
    for (const k of ['flagged','stale','untagged','expired']) {
      assert.ok(typeof body[k] === 'number' && body[k] >= 0, `${k} should be a non-negative number`);
    }
  });

  // 4. flagged count >= 1 (we flagged m1)
  await test('flagged count >= 1', async () => {
    const { body } = await req('GET', '/api/stats/health-summary');
    assert.ok(body.flagged >= 1, `expected flagged >= 1, got ${body.flagged}`);
  });

  // 5. untagged count >= 1 (NoTagMem has no tags)
  await test('untagged count >= 1', async () => {
    const { body } = await req('GET', '/api/stats/health-summary');
    assert.ok(body.untagged >= 1, `expected untagged >= 1, got ${body.untagged}`);
  });

  // 6. unflagging m1 reduces flagged count
  await test('unflagging reduces flagged count', async () => {
    const { body: before } = await req('GET', '/api/stats/health-summary');
    await req('POST', `/api/memories/${m1.id}/flag`); // toggle off
    const { body: after } = await req('GET', '/api/stats/health-summary');
    assert.ok(after.flagged < before.flagged, `expected flagged to decrease`);
    await req('POST', `/api/memories/${m1.id}/flag`); // restore
  });

  // 7. expired count accurate — seed an expired memory
  await test('expired count >= 1 when expired memory exists', async () => {
    const expiredAt = Date.now() - 86400000; // 1 day ago
    await req('POST', '/api/memories', { title: 'OldExpiry', content: 'expired memory here', memory_type: 'core', expires_at: expiredAt });
    const { body } = await req('GET', '/api/stats/health-summary');
    assert.ok(body.expired >= 1, `expected expired >= 1, got ${body.expired}`);
  });

  // 8. tagged memory does not inflate untagged count
  await test('tagged memory not counted as untagged', async () => {
    const { body: before } = await req('GET', '/api/stats/health-summary');
    await req('POST', '/api/memories', { title: 'AnotherTagged', content: 'another tagged memory', memory_type: 'core', tags: ['science'] });
    const { body: after } = await req('GET', '/api/stats/health-summary');
    assert.ok(after.untagged === before.untagged, `tagged memory should not change untagged count`);
  });

  const html = (await req('GET', '/')).body;

  // 9. HTML has ks-health-summary element
  await test('HTML has ks-health-summary element', async () => {
    assert.ok(html.includes('ks-health-summary'), 'expected ks-health-summary in HTML');
  });

  // 10. HTML fetches /api/stats/health-summary
  await test('HTML fetches /api/stats/health-summary', async () => {
    assert.ok(html.includes('/api/stats/health-summary'), 'expected health-summary endpoint in HTML');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
