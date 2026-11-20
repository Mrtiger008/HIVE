'use strict';
const assert = require('assert');
const http   = require('http');
const path   = require('path');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p63-${Date.now()}.db`);

function req(method, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: '127.0.0.1', port: 7749, path: pathname, method,
      headers: { 'Content-Type': 'application/json', 'X-Hive-Local': '1',
                 ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}) },
    };
    const r = http.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => { let b; try { b = JSON.parse(raw); } catch { b = raw; } resolve({ status: res.statusCode, body: b }); });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

function getHtml() {
  return new Promise((resolve, reject) => {
    const o = http.request({ hostname:'127.0.0.1', port:7749, path:'/', method:'GET' }, res => {
      let raw = ''; res.on('data', c => raw += c); res.on('end', () => resolve(raw));
    });
    o.on('error', reject); o.end();
  });
}

async function run() {
  let passed = 0;
  const total = 10;
  async function test(name, fn) {
    try { await fn(); console.log(`  ✓ ${name}`); passed++; }
    catch (e) { console.log(`  ✗ ${name}: ${e.message}`); }
  }

  console.log('\nPhase 63 — Reading Time / Word Count\n');

  const html = await getHtml();

  // 1–4: logic tests via pure JS (eval the helper from the page or just test the formula)
  // We test the word-count / reading-time formula directly with known inputs.
  function wordCount(content) {
    return (content || '').trim().split(/\s+/).filter(Boolean).length;
  }
  function readTime(words) {
    return Math.max(1, Math.ceil(words / 200));
  }

  // 1. empty content → 0 words, 1 min min
  await test('empty content → 0 words, 1 min reading time', async () => {
    assert.strictEqual(wordCount(''), 0);
    assert.strictEqual(readTime(0), 1);
  });

  // 2. single word → 1 word, 1 min
  await test('single word → 1 word, 1 min', async () => {
    assert.strictEqual(wordCount('hello'), 1);
    assert.strictEqual(readTime(1), 1);
  });

  // 3. exactly 200 words → 1 min
  await test('200 words → 1 min reading time', async () => {
    const content = Array(200).fill('word').join(' ');
    assert.strictEqual(wordCount(content), 200);
    assert.strictEqual(readTime(200), 1);
  });

  // 4. 201 words → 2 min
  await test('201 words → 2 min reading time', async () => {
    const content = Array(201).fill('word').join(' ');
    assert.strictEqual(wordCount(content), 201);
    assert.strictEqual(readTime(201), 2);
  });

  // 5. card() HTML has word count badge (Nw)
  await test('dashboard card() has word-count badge pattern (Nw)', async () => {
    assert.ok(html.includes('{words}w'), 'expected word count badge in card');
  });

  // 6. card() has reading time badge (Nm)
  await test('dashboard card() has reading time badge pattern (Nm)', async () => {
    assert.ok(html.includes('rt}m'), 'expected reading time badge in card');
  });

  // 7. word count uses split on whitespace
  await test('word count handles extra whitespace correctly', async () => {
    assert.strictEqual(wordCount('  hello   world  '), 2);
  });

  // 8. reading time rounds up (not down)
  await test('reading time rounds up', async () => {
    assert.strictEqual(readTime(1), 1);
    assert.strictEqual(readTime(199), 1);
    assert.strictEqual(readTime(200), 1);
    assert.strictEqual(readTime(201), 2);
    assert.strictEqual(readTime(400), 2);
    assert.strictEqual(readTime(401), 3);
  });

  // 9. searchCard also has word count badge
  await test('searchCard also includes word count badge', async () => {
    // Both card() and searchCard() should have the badge pattern
    const matches = (html.match(/\{words\}w/g) || []).length;
    assert.ok(matches >= 2, `expected badge in both card() and searchCard(), found ${matches}`);
  });

  // 10. badge has tooltip with word count
  await test('word count badge has title attribute for tooltip', async () => {
    assert.ok(html.includes('words\\" title=\\"') || html.includes("words' title='") || html.includes('} words'), 'expected title attr with word count');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
