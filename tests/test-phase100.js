'use strict';
const assert = require('assert');
const http   = require('http');
const path   = require('path');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p100-${Date.now()}.db`);

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

  console.log('\nPhase 100 — Memory Quick Stats Banner\n');

  // Seed known memories
  const { body: m1 } = await req('POST', '/api/memories', { title: 'Alpha', content: 'alpha content here', memory_type: 'core' });
  const { body: m2 } = await req('POST', '/api/memories', { title: 'Beta',  content: 'beta content here',  memory_type: 'core' });
  await req('POST', `/api/memories/${m1.id}/star`);
  await req('POST', `/api/memories/${m1.id}/pin`);
  await req('POST', `/api/memories/${m2.id}/mark-read`);

  // 1. /api/stats returns 200
  await test('GET /api/stats returns 200', async () => {
    const { status } = await req('GET', '/api/stats');
    assert.strictEqual(status, 200);
  });

  // 2. stats includes starred count
  await test('stats includes starred count', async () => {
    const { body } = await req('GET', '/api/stats');
    assert.ok('starred' in body, 'expected starred field in stats');
    assert.ok(typeof body.starred === 'number', 'starred should be a number');
  });

  // 3. stats includes unread count
  await test('stats includes unread count', async () => {
    const { body } = await req('GET', '/api/stats');
    assert.ok('unread' in body, 'expected unread field in stats');
    assert.ok(typeof body.unread === 'number', 'unread should be a number');
  });

  // 4. starred count reflects starred memories
  await test('starred count >= 1 after starring m1', async () => {
    const { body } = await req('GET', '/api/stats');
    assert.ok(body.starred >= 1, `starred should be >= 1, got ${body.starred}`);
  });

  // 5. pinned count >= 1 after pinning m1
  await test('pinned count >= 1 after pinning m1', async () => {
    const { body } = await req('GET', '/api/stats');
    assert.ok(body.pinned >= 1, `pinned should be >= 1, got ${body.pinned}`);
  });

  // 6. unread count reflects unread memories (m2 is read, m1 is not)
  await test('unread count reflects read status', async () => {
    const { body: before } = await req('GET', '/api/stats');
    // mark m1 read too
    await req('POST', `/api/memories/${m1.id}/mark-read`);
    const { body: after } = await req('GET', '/api/stats');
    assert.ok(after.unread <= before.unread, 'unread count should decrease after marking read');
    // restore
    await req('POST', `/api/memories/${m1.id}/mark-unread`);
  });

  // 7. memories count >= 2
  await test('memories count >= 2', async () => {
    const { body } = await req('GET', '/api/stats');
    assert.ok(body.memories >= 2, `memories count should be >= 2, got ${body.memories}`);
  });

  // 8. stats still includes memories, entities, projects, pinned
  await test('stats retains existing fields', async () => {
    const { body } = await req('GET', '/api/stats');
    assert.ok('memories' in body && 'entities' in body && 'projects' in body && 'pinned' in body,
      'expected memories, entities, projects, pinned fields');
  });

  const html = (await req('GET', '/')).body;

  // 9. HTML has mem-qstats element
  await test('HTML has mem-qstats element', async () => {
    assert.ok(html.includes('mem-qstats'), 'expected mem-qstats div in HTML');
  });

  // 10. refreshStats populates starred and unread
  await test('refreshStats uses starred and unread from stats', async () => {
    assert.ok(html.includes('d.starred') && html.includes('d.unread'),
      'expected d.starred and d.unread in refreshStats function');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
