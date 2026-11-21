'use strict';
const assert = require('assert');
const http   = require('http');
const path   = require('path');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p77-${Date.now()}.db`);

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

function wc(text) { return (text||'').trim().split(/\s+/).filter(Boolean).length; }

async function run() {
  let passed = 0;
  const total = 10;
  async function test(name, fn) {
    try { await fn(); console.log(`  ✓ ${name}`); passed++; }
    catch (e) { console.log(`  ✗ ${name}: ${e.message}`); }
  }

  console.log('\nPhase 77 — Memory Word Count Filter\n');

  // Seed memories: 3 words, 10 words, 25 words
  const short  = 'one two three';
  const medium = 'one two three four five six seven eight nine ten';
  const long   = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee';

  const { body: mS } = await req('POST', '/api/memories', { title: 'Short',  content: short,  memory_type: 'core' });
  const { body: mM } = await req('POST', '/api/memories', { title: 'Medium', content: medium, memory_type: 'core' });
  const { body: mL } = await req('POST', '/api/memories', { title: 'Long',   content: long,   memory_type: 'core' });

  const ids = new Set([mS.id, mM.id, mL.id]);
  function subset(list) { return list.filter(m => ids.has(m.id)); }

  // 1. min_words=10 returns medium and long, not short
  await test('min_words=10 excludes short memory', async () => {
    const { status, body } = await req('GET', '/api/memories?min_words=10&limit=1000');
    assert.strictEqual(status, 200);
    const sub = subset(body);
    assert.ok(sub.some(m => m.id === mM.id), 'medium should be included');
    assert.ok(sub.some(m => m.id === mL.id), 'long should be included');
    assert.ok(!sub.some(m => m.id === mS.id), 'short should be excluded');
  });

  // 2. max_words=5 returns only short
  await test('max_words=5 returns only short memory', async () => {
    const { status, body } = await req('GET', '/api/memories?max_words=5&limit=1000');
    assert.strictEqual(status, 200);
    const sub = subset(body);
    assert.ok(sub.some(m => m.id === mS.id), 'short should be included');
    assert.ok(!sub.some(m => m.id === mM.id), 'medium should be excluded');
    assert.ok(!sub.some(m => m.id === mL.id), 'long should be excluded');
  });

  // 3. min_words + max_words range returns only medium
  await test('min_words=5 max_words=15 returns only medium', async () => {
    const { body } = await req('GET', '/api/memories?min_words=5&max_words=15&limit=1000');
    const sub = subset(body);
    assert.ok(sub.some(m => m.id === mM.id), 'medium should be included');
    assert.ok(!sub.some(m => m.id === mS.id), 'short should be excluded');
    assert.ok(!sub.some(m => m.id === mL.id), 'long should be excluded');
  });

  // 4. exact boundary: min_words=3 includes short (3 words)
  await test('min_words=3 includes exactly-3-word memory', async () => {
    const { body } = await req('GET', '/api/memories?min_words=3&limit=1000');
    const sub = subset(body);
    assert.ok(sub.some(m => m.id === mS.id), 'short (3 words) should be included at min=3');
  });

  // 5. exact boundary: max_words=3 includes short, excludes medium
  await test('max_words=3 excludes memory with more words', async () => {
    const { body } = await req('GET', '/api/memories?max_words=3&limit=1000');
    const sub = subset(body);
    assert.ok(sub.some(m => m.id === mS.id), 'short should be included');
    assert.ok(!sub.some(m => m.id === mM.id), 'medium should be excluded');
  });

  // 6. no word filter returns all memories
  await test('no word filter returns all seeded memories', async () => {
    const { body } = await req('GET', '/api/memories?limit=1000');
    const sub = subset(body);
    assert.strictEqual(sub.length, 3, `expected 3, got ${sub.length}`);
  });

  const html = (await req('GET', '/')).body;

  // 7. HTML has mminw input
  await test('HTML has #mminw min-words input', async () => {
    assert.ok(html.includes('id="mminw"'), 'expected mminw input');
  });

  // 8. HTML has mmaxw input
  await test('HTML has #mmaxw max-words input', async () => {
    assert.ok(html.includes('id="mmaxw"'), 'expected mmaxw input');
  });

  // 9. clearAllMemFilters includes mminw and mmaxw
  await test('clearAllMemFilters clears word count inputs', async () => {
    assert.ok(html.includes("'mminw'") && html.includes("'mmaxw'"), 'expected mminw/mmaxw in clearAll');
  });

  // 10. _memUrl includes min_words and max_words params
  await test('_memUrl includes min_words / max_words params', async () => {
    assert.ok(html.includes('min_words') && html.includes('max_words'), 'expected min_words/max_words in URL builder');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
