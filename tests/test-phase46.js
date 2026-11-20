'use strict';
const assert = require('assert');
const path   = require('path');
const http   = require('http');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p46-${Date.now()}.db`);

const memory = require('../src/memory');
const h      = require('../src/health');

function req(pathname) {
  return new Promise((resolve, reject) => {
    const opts = { hostname: '127.0.0.1', port: 7749, path: pathname, method: 'GET',
      headers: { 'X-Hive-Local': '1' } };
    const r = http.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => { let b; try { b = JSON.parse(raw); } catch { b = raw; } resolve({ status: res.statusCode, body: b }); });
    });
    r.on('error', reject); r.end();
  });
}

async function run() {
  let passed = 0;
  const total = 10;
  async function test(name, fn) {
    try { await fn(); console.log(`  ✓ ${name}`); passed++; }
    catch (e) { console.log(`  ✗ ${name}: ${e.message}`); }
  }

  console.log('\nPhase 46 — Memory Health Score\n');

  // 1. score() returns a number 0-100
  await test('score() returns number 0-100', async () => {
    const m = { confidence: 0.8, importance: 7, last_accessed_at: Date.now(), updated_at: Date.now() };
    const s = h.score(m);
    assert.ok(typeof s === 'number');
    assert.ok(s >= 0 && s <= 100);
  });

  // 2. high-confidence, recently accessed, high importance → high score
  await test('healthy memory scores high', async () => {
    const m = { confidence: 1.0, importance: 10, last_accessed_at: Date.now(), updated_at: Date.now() };
    assert.ok(h.score(m) >= 70);
  });

  // 3. low confidence, stale, low importance → low score
  await test('unhealthy memory scores low', async () => {
    const stale = Date.now() - 90 * 86400000; // 90 days ago
    const m = { confidence: 0.1, importance: 1, last_accessed_at: stale, updated_at: stale };
    assert.ok(h.score(m) < 40);
  });

  // 4. grade() correct thresholds
  await test('grade() returns good/fair/poor correctly', async () => {
    assert.strictEqual(h.grade(75), 'good');
    assert.strictEqual(h.grade(55), 'fair');
    assert.strictEqual(h.grade(30), 'poor');
    assert.strictEqual(h.grade(70), 'good');
    assert.strictEqual(h.grade(40), 'fair');
    assert.strictEqual(h.grade(39), 'poor');
  });

  // 5. list() returns expected shape
  await test('list() returns {memories, total, summary} shape', async () => {
    memory.add({ title: 'Health test A', content: 'Content A', memory_type: 'semantic', confidence: 0.9, importance: 8 });
    const d = h.list({ limit: 10 });
    assert.ok(Array.isArray(d.memories));
    assert.ok(typeof d.total === 'number');
    assert.ok(typeof d.summary.avg_score === 'number');
    assert.ok('good' in d.summary && 'fair' in d.summary && 'poor' in d.summary);
  });

  // 6. each memory in list has health_score and health_grade
  await test('each memory has health_score and health_grade fields', async () => {
    const d = h.list({ limit: 10 });
    for (const m of d.memories) {
      assert.ok(typeof m.health_score === 'number', 'missing health_score');
      assert.ok(['good','fair','poor'].includes(m.health_grade), 'invalid health_grade');
    }
  });

  // 7. sortOrder asc → first entry has lower or equal score than last
  await test('sortOrder asc returns worst first', async () => {
    memory.add({ title: 'Low conf mem', content: 'C', memory_type: 'semantic', confidence: 0.1, importance: 1 });
    memory.add({ title: 'High conf mem', content: 'C', memory_type: 'semantic', confidence: 0.95, importance: 9 });
    const d = h.list({ sortOrder: 'asc', limit: 50 });
    const scores = d.memories.map(m => m.health_score);
    for (let i = 1; i < scores.length; i++) {
      assert.ok(scores[i] >= scores[i - 1], `score at ${i} (${scores[i]}) < score at ${i-1} (${scores[i-1]})`);
    }
  });

  // 8. gradeFilter returns only that grade
  await test('gradeFilter returns only memories of that grade', async () => {
    const d = h.list({ gradeFilter: 'poor', limit: 50 });
    for (const m of d.memories) {
      assert.strictEqual(m.health_grade, 'poor', `expected poor, got ${m.health_grade}`);
    }
  });

  // 9. GET /api/health returns 200 with shape
  await test('GET /api/health returns 200 with correct shape', async () => {
    const r = await req('/api/health');
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.body.memories));
    assert.ok(typeof r.body.summary === 'object');
  });

  // 10. GET /api/health?sort=desc returns best first
  await test('GET /api/health?sort=desc returns best first', async () => {
    const r = await req('/api/health?sort=desc&limit=50');
    assert.strictEqual(r.status, 200);
    const scores = r.body.memories.map(m => m.health_score);
    for (let i = 1; i < scores.length; i++) {
      assert.ok(scores[i] <= scores[i - 1], `expected descending at ${i}`);
    }
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
