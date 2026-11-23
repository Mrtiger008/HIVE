'use strict';
const assert = require('assert');
const http   = require('http');
const path   = require('path');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p99-${Date.now()}.db`);

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

  console.log('\nPhase 99 — Tag Co-occurrence\n');

  // Seed memories with known tag overlaps
  // js+python: appears 3 times
  // js+react:  appears 2 times
  // python+ai: appears 1 time
  await req('POST', '/api/memories', { title: 'A', content: 'alpha content here', memory_type: 'core', tags: ['js', 'python'] });
  await req('POST', '/api/memories', { title: 'B', content: 'beta content here',  memory_type: 'core', tags: ['js', 'python', 'react'] });
  await req('POST', '/api/memories', { title: 'C', content: 'gamma content here', memory_type: 'core', tags: ['js', 'python'] });
  await req('POST', '/api/memories', { title: 'D', content: 'delta content here', memory_type: 'core', tags: ['python', 'ai'] });

  // 1. endpoint returns 200
  await test('GET /api/tags/cooccurrence returns 200', async () => {
    const { status } = await req('GET', '/api/tags/cooccurrence');
    assert.strictEqual(status, 200);
  });

  // 2. returns array
  await test('cooccurrence returns an array', async () => {
    const { body } = await req('GET', '/api/tags/cooccurrence');
    assert.ok(Array.isArray(body));
  });

  // 3. items have tags (array) and count fields
  await test('items have tags and count fields', async () => {
    const { body } = await req('GET', '/api/tags/cooccurrence');
    assert.ok(body.length > 0, 'expected at least one pair');
    assert.ok(Array.isArray(body[0].tags) && body[0].tags.length === 2, 'tags should be a 2-element array');
    assert.ok(typeof body[0].count === 'number', 'count should be a number');
  });

  // 4. sorted by count descending
  await test('results sorted by count descending', async () => {
    const { body } = await req('GET', '/api/tags/cooccurrence');
    for (let i = 1; i < body.length; i++) {
      assert.ok(body[i-1].count >= body[i].count, `item ${i-1} count should be >= item ${i}`);
    }
  });

  // 5. js+python pair has count >= 3 (appears in A, B, C)
  await test('js+python pair has count >= 3', async () => {
    const { body } = await req('GET', '/api/tags/cooccurrence');
    const pair = body.find(p => p.tags.includes('js') && p.tags.includes('python'));
    assert.ok(pair, 'js+python pair should exist');
    assert.ok(pair.count >= 3, `js+python should have count >= 3, got ${pair?.count}`);
  });

  // 6. js+python has higher count than js+react (appeared 3 vs 1 time in seeded data)
  await test('js+python count > js+react count', async () => {
    const { body } = await req('GET', '/api/tags/cooccurrence?limit=100');
    const jsPy = body.find(p => p.tags.includes('js') && p.tags.includes('python'));
    const jsRe = body.find(p => p.tags.includes('js') && p.tags.includes('react'));
    assert.ok(jsPy, 'js+python pair should exist');
    assert.ok(jsRe, 'js+react pair should exist');
    assert.ok(jsPy.count > jsRe.count, `js+python (${jsPy?.count}) should have higher count than js+react (${jsRe?.count})`);
  });

  // 7. limit param is respected
  await test('limit param caps result count', async () => {
    const { body } = await req('GET', '/api/tags/cooccurrence?limit=2');
    assert.ok(body.length <= 2, 'should return at most 2 pairs');
  });

  // 8. python+ai pair exists (use large limit to find it in production DB)
  await test('python+ai pair exists', async () => {
    const { body } = await req('GET', '/api/tags/cooccurrence?limit=100');
    const pair = body.find(p => p.tags.includes('python') && p.tags.includes('ai'));
    assert.ok(pair, 'python+ai pair should exist');
    assert.ok(pair.count >= 1, 'python+ai should have count >= 1');
  });

  const html = (await req('GET', '/')).body;

  // 9. HTML references the cooccurrence endpoint
  await test('HTML fetches /api/tags/cooccurrence', async () => {
    assert.ok(html.includes('/api/tags/cooccurrence'), 'expected cooccurrence endpoint in HTML');
  });

  // 10. HTML has Top tag pairs section
  await test('HTML has Top tag pairs section', async () => {
    assert.ok(html.includes('Top tag pairs') || html.includes('tc-pairs'), 'expected Top tag pairs section in HTML');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
