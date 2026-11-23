'use strict';
const assert = require('assert');
const http   = require('http');
const path   = require('path');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p95-${Date.now()}.db`);

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

  console.log('\nPhase 95 — Memory Word Frequency\n');

  // Seed memories with known repeated words
  await req('POST', '/api/memories', { title: 'Alpha', content: 'javascript framework pattern pattern pattern', memory_type: 'core' });
  await req('POST', '/api/memories', { title: 'Beta',  content: 'javascript javascript async pattern', memory_type: 'core' });
  await req('POST', '/api/memories', { title: 'Gamma', content: 'python async async', memory_type: 'core' });

  // 1. GET /api/stats/wordfreq returns 200
  await test('GET /api/stats/wordfreq returns 200', async () => {
    const { status } = await req('GET', '/api/stats/wordfreq');
    assert.strictEqual(status, 200);
  });

  // 2. Returns an array
  await test('wordfreq returns an array', async () => {
    const { body } = await req('GET', '/api/stats/wordfreq');
    assert.ok(Array.isArray(body), 'expected array');
  });

  // 3. Items have word and count fields
  await test('items have word and count fields', async () => {
    const { body } = await req('GET', '/api/stats/wordfreq');
    assert.ok(body.length > 0, 'expected at least one word');
    assert.ok('word' in body[0] && 'count' in body[0], 'expected word and count fields');
  });

  // 4. Results are sorted by count descending
  await test('results sorted by count descending', async () => {
    const { body } = await req('GET', '/api/stats/wordfreq');
    for (let i = 1; i < body.length; i++) {
      assert.ok(body[i-1].count >= body[i].count, `item ${i-1} should have count >= item ${i}`);
    }
  });

  // 5. Known high-frequency word appears near top (pattern: 4 occurrences)
  await test('high-frequency word appears in results', async () => {
    const { body } = await req('GET', '/api/stats/wordfreq');
    const pat = body.find(w => w.word === 'pattern');
    assert.ok(pat, 'pattern should appear in results');
    assert.ok(pat.count >= 4, 'pattern should have count >= 4');
  });

  // 6. javascript appears with correct count (3 occurrences)
  await test('javascript word count is correct', async () => {
    const { body } = await req('GET', '/api/stats/wordfreq');
    const js = body.find(w => w.word === 'javascript');
    assert.ok(js && js.count >= 3, 'javascript should appear with count >= 3');
  });

  // 7. limit param is respected
  await test('limit param caps result count', async () => {
    const { body } = await req('GET', '/api/stats/wordfreq?limit=2');
    assert.ok(body.length <= 2, 'should return at most 2 results');
  });

  // 8. Common stopwords are excluded
  await test('common stopwords are excluded', async () => {
    const { body } = await req('GET', '/api/stats/wordfreq');
    const stopwords = ['the', 'and', 'for', 'with', 'this', 'that', 'are'];
    for (const sw of stopwords) {
      assert.ok(!body.some(w => w.word === sw), `stopword "${sw}" should be excluded`);
    }
  });

  const html = (await req('GET', '/')).body;

  // 9. HTML has /api/stats/wordfreq referenced in loadKStats
  await test('loadKStats fetches /api/stats/wordfreq', async () => {
    assert.ok(html.includes('/api/stats/wordfreq'), 'expected wordfreq endpoint in HTML');
  });

  // 10. HTML renders word cloud (Top words section)
  await test('HTML has Top words section', async () => {
    assert.ok(html.includes('Top words'), 'expected Top words heading in HTML');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
