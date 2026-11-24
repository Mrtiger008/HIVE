'use strict';
const assert = require('assert');
const http   = require('http');

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

  console.log('\nPhase 124 — Memory Result Count\n');

  // Seed memories: two with same domain, one different
  await req('POST', '/api/memories', { title: 'P124-A', content: 'alpha content here', memory_type: 'core',   domain: 'p124dom' });
  await req('POST', '/api/memories', { title: 'P124-B', content: 'beta content here',  memory_type: 'core',   domain: 'p124dom' });
  await req('POST', '/api/memories', { title: 'P124-C', content: 'gamma content here', memory_type: 'domain', domain: 'other' });

  // 1. GET /api/memories/count returns 200
  await test('GET /api/memories/count returns 200', async () => {
    const { status } = await req('GET', '/api/memories/count');
    assert.strictEqual(status, 200);
  });

  // 2. Response has count field as number
  await test('/api/memories/count response has numeric count', async () => {
    const { body } = await req('GET', '/api/memories/count');
    assert.ok(typeof body.count === 'number', `expected numeric count, got ${typeof body.count}`);
    assert.ok(body.count >= 3, `expected at least 3 memories (seeded), got ${body.count}`);
  });

  // 3. Count with domain filter returns correct number
  await test('/api/memories/count?domain=p124dom returns 2', async () => {
    const { body } = await req('GET', '/api/memories/count?domain=p124dom');
    assert.strictEqual(body.count, 2, `expected 2 for domain=p124dom, got ${body.count}`);
  });

  // 4. Count with type filter returns correct number
  await test('/api/memories/count?type=domain returns seeded p124-C', async () => {
    const { body: list } = await req('GET', '/api/memories?type=domain&limit=1000');
    const { body: cnt }  = await req('GET', '/api/memories/count?type=domain');
    assert.strictEqual(cnt.count, list.length, `count ${cnt.count} should match list length ${list.length}`);
  });

  // 5. Count with text search filter
  await test('/api/memories/count?search=alpha returns 1', async () => {
    const { body } = await req('GET', '/api/memories/count?search=alpha');
    assert.ok(body.count >= 1, `expected at least 1 for search=alpha, got ${body.count}`);
  });

  // 6. Count for nonexistent domain returns 0
  await test('/api/memories/count?domain=nonexistent_xyzzy returns 0', async () => {
    const { body } = await req('GET', '/api/memories/count?domain=nonexistent_xyzzy');
    assert.strictEqual(body.count, 0);
  });

  // 7. Count without filters >= count with domain filter
  await test('total count >= domain-filtered count', async () => {
    const { body: total } = await req('GET', '/api/memories/count');
    const { body: filtered } = await req('GET', '/api/memories/count?domain=p124dom');
    assert.ok(total.count >= filtered.count, 'total should be >= filtered');
  });

  // 8. Count matches list length for same params (no post-filter params)
  await test('count matches list length for same params', async () => {
    const { body: cnt }  = await req('GET', '/api/memories/count?domain=p124dom');
    const { body: list } = await req('GET', '/api/memories?domain=p124dom&limit=10000');
    assert.strictEqual(cnt.count, list.length, `count ${cnt.count} should match list length ${list.length}`);
  });

  const html = (await req('GET', '/')).body;

  // 9. HTML references /api/memories/count
  await test('HTML fetches /api/memories/count', async () => {
    assert.ok(html.includes('/api/memories/count'), 'expected /api/memories/count in HTML');
  });

  // 10. HTML has mem-qstats element
  await test('HTML has mem-qstats element', async () => {
    assert.ok(html.includes('mem-qstats'), 'expected mem-qstats element in HTML');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
