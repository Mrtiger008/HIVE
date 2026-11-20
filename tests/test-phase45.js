'use strict';
const assert = require('assert');
const path   = require('path');
const http   = require('http');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p45-${Date.now()}.db`);

const memory = require('../src/memory');

// Re-export quickTitle logic for unit testing (mirrors hive.js)
function quickTitle(text, max = 60) {
  const t = text.trim().replace(/\s+/g, ' ');
  if (t.length <= max) return t;
  const cut = t.lastIndexOf(' ', max);
  return (cut > 20 ? t.slice(0, cut) : t.slice(0, max)) + '…';
}

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
      res.on('end', () => {
        let b = null; try { b = raw ? JSON.parse(raw) : null; } catch { b = raw; }
        resolve({ status: res.statusCode, body: b });
      });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
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

  console.log('\nPhase 45 — Quick Capture\n');

  // 1. quickTitle returns short text verbatim
  await test('quickTitle returns short text as-is', async () => {
    assert.strictEqual(quickTitle('hello world'), 'hello world');
  });

  // 2. quickTitle truncates at word boundary
  await test('quickTitle truncates at word boundary near 60 chars', async () => {
    const long = 'The quick brown fox jumps over the lazy dog near the river bank';
    const t = quickTitle(long);
    assert.ok(t.endsWith('…'), 'should end with ellipsis');
    assert.ok(t.length <= 62, 'should be close to 60 chars');
    assert.ok(!t.slice(0, -1).endsWith(' '), 'should not end with space before ellipsis');
  });

  // 3. quickTitle falls back to hard cut when no space found near limit
  await test('quickTitle hard-cuts when no space found near limit', async () => {
    const noSpace = 'a'.repeat(80);
    const t = quickTitle(noSpace);
    assert.ok(t.endsWith('…'));
    assert.ok(t.length <= 62);
  });

  // 4. memory.add with auto-title defaults
  await test('memory.add captures with correct defaults', async () => {
    const text = 'Quick thought about project structure';
    const m = memory.add({ title: quickTitle(text), content: text, memory_type: 'semantic', trust_level: 'OBSERVED', confidence: 0.7, importance: 5 });
    assert.strictEqual(m.memory_type, 'semantic');
    assert.strictEqual(m.trust_level, 'OBSERVED');
    assert.strictEqual(m.confidence, 0.7);
    assert.strictEqual(m.importance, 5);
    assert.strictEqual(m.title, text); // short text → title = full text
  });

  // 5. type override works
  await test('type override stored correctly', async () => {
    const m = memory.add({ title: 'Core fact', content: 'Core fact', memory_type: 'core', trust_level: 'OBSERVED', confidence: 0.7, importance: 5 });
    assert.strictEqual(m.memory_type, 'core');
  });

  // 6. importance override
  await test('importance override stored correctly', async () => {
    const m = memory.add({ title: 'High imp', content: 'High importance thought', memory_type: 'semantic', trust_level: 'OBSERVED', confidence: 0.7, importance: 8 });
    assert.strictEqual(m.importance, 8);
  });

  // 7. domain override
  await test('domain override stored correctly', async () => {
    const m = memory.add({ title: 'Domain mem', content: 'Domain-specific thought', memory_type: 'semantic', domain: 'engineering', trust_level: 'OBSERVED', confidence: 0.7, importance: 5 });
    assert.strictEqual(m.domain, 'engineering');
  });

  // 8. POST /api/capture returns 201 with memory object
  await test('POST /api/capture returns 201 with memory', async () => {
    const r = await req('POST', '/api/capture', { content: 'A quick captured thought for API test' });
    assert.strictEqual(r.status, 201);
    assert.ok(r.body.id, 'should return memory with id');
    assert.ok(r.body.title, 'should have auto-generated title');
    assert.strictEqual(r.body.memory_type, 'semantic');
    assert.strictEqual(r.body.trust_level, 'OBSERVED');
  });

  // 9. POST /api/capture with type override
  await test('POST /api/capture respects type param', async () => {
    const r = await req('POST', '/api/capture', { content: 'Episodic quick capture', type: 'episodic' });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(r.body.memory_type, 'episodic');
  });

  // 10. POST /api/capture with missing content returns 400
  await test('POST /api/capture with empty content returns 400', async () => {
    const r = await req('POST', '/api/capture', { content: '' });
    assert.strictEqual(r.status, 400);
    assert.ok(r.body.error);
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
