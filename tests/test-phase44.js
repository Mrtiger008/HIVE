'use strict';
const assert = require('assert');
const path   = require('path');
const http   = require('http');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p44-${Date.now()}.db`);

const memory = require('../src/memory');
const gaps   = require('../src/gaps');

function req(method, pathname) {
  return new Promise((resolve, reject) => {
    const opts = { hostname: '127.0.0.1', port: 7749, path: pathname, method,
      headers: { 'Content-Type': 'application/json', 'X-Hive-Local': '1' } };
    const r = http.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        let b = null; try { b = raw ? JSON.parse(raw) : null; } catch { b = raw; }
        resolve({ status: res.statusCode, body: b });
      });
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

  console.log('\nPhase 44 — Knowledge Gaps\n');

  // 1. get() returns expected shape on empty DB
  await test('get() returns {gaps, total, summary} shape', async () => {
    const d = gaps.get();
    assert.ok(Array.isArray(d.gaps));
    assert.ok(typeof d.total === 'number');
    assert.ok(typeof d.summary === 'object');
    assert.ok('critical_memories' in d.summary);
    assert.ok('low_confidence_domains' in d.summary);
    assert.ok('sparse_domains' in d.summary);
  });

  // 2. critical gap detected for high-importance, low-confidence memory
  await test('critical gap detected: importance >= 7, confidence < 0.5', async () => {
    memory.add({ title: 'Critical mem', content: 'C', memory_type: 'core',
      importance: 9, confidence: 0.2 });
    const d = gaps.get({ importanceFloor: 7, confThreshold: 0.5 });
    assert.ok(d.summary.critical_memories >= 1, 'should detect critical memory');
    const crit = d.gaps.find(g => g.type === 'critical');
    assert.ok(crit, 'should have a critical gap entry');
    assert.strictEqual(crit.severity, 'high'); // conf < 0.3 → high
  });

  // 3. low-confidence domain gap detected
  await test('low_confidence domain gap detected when avg_conf < threshold', async () => {
    memory.add({ title: 'Low conf A', content: 'C', memory_type: 'semantic',
      domain: 'physics', confidence: 0.2, importance: 3 });
    memory.add({ title: 'Low conf B', content: 'C', memory_type: 'semantic',
      domain: 'physics', confidence: 0.3, importance: 3 });
    const d = gaps.get({ confThreshold: 0.5 });
    const domGap = d.gaps.find(g => g.type === 'low_confidence' && g.scope === 'domain' && g.label === 'physics');
    assert.ok(domGap, 'should detect low-confidence domain');
    assert.ok(domGap.avg_confidence < 0.5);
  });

  // 4. sparse domain gap detected
  await test('sparse gap detected when domain has fewer than minCount memories', async () => {
    memory.add({ title: 'Only mem', content: 'C', memory_type: 'core',
      domain: 'rare-domain', confidence: 0.9, importance: 3 });
    const d = gaps.get({ minCount: 3 });
    const sparse = d.gaps.find(g => g.type === 'sparse' && g.label === 'rare-domain');
    assert.ok(sparse, 'should detect sparse domain');
    assert.strictEqual(sparse.severity, 'high'); // count === 1 → high
  });

  // 5. high-confidence domain does NOT appear as low_confidence gap
  await test('high-confidence domain not flagged as gap', async () => {
    memory.add({ title: 'Good A', content: 'C', memory_type: 'core', domain: 'solid', confidence: 0.9 });
    memory.add({ title: 'Good B', content: 'C', memory_type: 'core', domain: 'solid', confidence: 0.8 });
    memory.add({ title: 'Good C', content: 'C', memory_type: 'core', domain: 'solid', confidence: 0.85 });
    const d = gaps.get({ confThreshold: 0.5, minCount: 3 });
    const solidGap = d.gaps.find(g => g.label === 'solid' && g.type === 'low_confidence');
    assert.ok(!solidGap, 'solid domain should not be flagged as low-confidence');
  });

  // 6. gaps sorted: high severity before medium
  await test('gaps sorted high severity before medium', async () => {
    const d = gaps.get();
    let seenMedium = false;
    for (const gap of d.gaps) {
      if (gap.severity === 'medium') seenMedium = true;
      if (gap.severity === 'high' && seenMedium) {
        assert.fail('high severity gap appeared after medium severity gap');
      }
    }
  });

  // 7. each gap has type, scope, label, severity, avg_confidence
  await test('each gap entry has required fields', async () => {
    const d = gaps.get();
    for (const g of d.gaps) {
      assert.ok(typeof g.type         === 'string', `missing type in ${JSON.stringify(g)}`);
      assert.ok(typeof g.scope        === 'string', `missing scope`);
      assert.ok(typeof g.label        === 'string', `missing label`);
      assert.ok(typeof g.severity     === 'string', `missing severity`);
      assert.ok(typeof g.avg_confidence === 'number', `missing avg_confidence`);
      assert.ok(['low_confidence','sparse','critical'].includes(g.type));
      assert.ok(['high','medium'].includes(g.severity));
    }
  });

  // 8. confThreshold param controls detection
  await test('confThreshold param controls which domains are flagged', async () => {
    // With threshold 0.1, physics (avg ~0.25) should NOT be flagged
    const d = gaps.get({ confThreshold: 0.1 });
    const physGap = d.gaps.find(g => g.type === 'low_confidence' && g.label === 'physics');
    assert.ok(!physGap, 'physics should not be flagged below its avg_confidence');
  });

  // 9. critical gap severity: conf < 0.3 → high, 0.3–0.5 → medium
  await test('critical gap severity based on confidence level', async () => {
    memory.add({ title: 'Medium crit', content: 'C', memory_type: 'core',
      importance: 8, confidence: 0.4 });
    const d = gaps.get({ importanceFloor: 7, confThreshold: 0.5 });
    const medium = d.gaps.find(g => g.type === 'critical' && g.avg_confidence >= 0.3 && g.avg_confidence < 0.5);
    assert.ok(medium && medium.severity === 'medium', 'conf 0.3-0.5 should be medium severity');
  });

  // 10. API GET /api/gaps returns expected shape
  await test('GET /api/gaps returns {gaps, total, summary}', async () => {
    const r = await req('GET', '/api/gaps');
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.body.gaps));
    assert.ok(typeof r.body.total === 'number');
    assert.ok(typeof r.body.summary === 'object');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
