'use strict';
const assert = require('assert');
const http   = require('http');
const path   = require('path');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p88-${Date.now()}.db`);

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

  console.log('\nPhase 88 — Tag Usage Heatmap\n');

  // Seed 3 memories with the same tag
  await req('POST', '/api/memories', { title: 'H1', content: 'x', memory_type: 'core', tags: ['heattest88'] });
  await req('POST', '/api/memories', { title: 'H2', content: 'x', memory_type: 'core', tags: ['heattest88'] });
  await req('POST', '/api/memories', { title: 'H3', content: 'x', memory_type: 'core', tags: ['other88'] });

  // 1. GET /api/tags/heatmap?tag= returns 200
  await test('GET /api/tags/heatmap returns 200', async () => {
    const { status } = await req('GET', '/api/tags/heatmap?tag=heattest88');
    assert.strictEqual(status, 200);
  });

  // 2. heatmap returns an array
  await test('heatmap returns an array', async () => {
    const { body } = await req('GET', '/api/tags/heatmap?tag=heattest88');
    assert.ok(Array.isArray(body), 'expected array response');
  });

  // 3. heatmap buckets have week and count fields
  await test('heatmap buckets have week and count', async () => {
    const { body } = await req('GET', '/api/tags/heatmap?tag=heattest88');
    assert.ok(body.length > 0, 'expected at least one bucket');
    assert.ok('week' in body[0] && 'count' in body[0], 'expected week and count fields');
  });

  // 4. heatmap count matches seeded memories
  await test('heatmap total count matches seeded memories', async () => {
    const { body } = await req('GET', '/api/tags/heatmap?tag=heattest88');
    const total = body.reduce((s, b) => s + b.count, 0);
    assert.strictEqual(total, 2, 'expected 2 memories with heattest88');
  });

  // 5. heatmap for other tag returns its own count
  await test('heatmap for other tag returns correct count', async () => {
    const { body } = await req('GET', '/api/tags/heatmap?tag=other88');
    const total = body.reduce((s, b) => s + b.count, 0);
    assert.strictEqual(total, 1, 'expected 1 memory with other88');
  });

  // 6. heatmap for nonexistent tag returns empty array
  await test('heatmap for nonexistent tag returns empty array', async () => {
    const { body } = await req('GET', '/api/tags/heatmap?tag=zzznoneexist88');
    assert.ok(Array.isArray(body) && body.length === 0);
  });

  // 7. heatmap without tag returns 400
  await test('heatmap without tag returns 400', async () => {
    const { status } = await req('GET', '/api/tags/heatmap');
    assert.strictEqual(status, 400);
  });

  const html = (await req('GET', '/')).body;

  // 8. HTML has renderHeatmap function
  await test('HTML has renderHeatmap function', async () => {
    assert.ok(html.includes('function renderHeatmap('), 'expected renderHeatmap function');
  });

  // 9. HTML has tc-heatmap element
  await test('HTML has tc-heatmap element', async () => {
    assert.ok(html.includes('id="tc-heatmap"'), 'expected #tc-heatmap in HTML');
  });

  // 10. heatmap fetches /api/tags/heatmap in selectTag
  await test('selectTag fetches /api/tags/heatmap', async () => {
    assert.ok(html.includes('/api/tags/heatmap'), 'expected /api/tags/heatmap referenced in selectTag');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
