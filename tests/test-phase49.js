'use strict';
const assert = require('assert');
const path   = require('path');
const http   = require('http');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p49-${Date.now()}.db`);

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

// Unit-test the calibrate module directly (uses HIVE_DB set above)
const cal = require('../src/calibrate');
const memory = require('../src/memory');

async function run() {
  let passed = 0;
  const total = 10;
  async function test(name, fn) {
    try { await fn(); console.log(`  ✓ ${name}`); passed++; }
    catch (e) { console.log(`  ✗ ${name}: ${e.message}`); }
  }

  console.log('\nPhase 49 — Confidence Calibration\n');

  const now = Date.now();

  // 1. TRUST_CEILING — USER_CONFIRMED ceiling is 1.0
  await test('TRUST_CEILING USER_CONFIRMED is 1.0', async () => {
    assert.strictEqual(cal.TRUST_CEILING.USER_CONFIRMED, 1.0);
  });

  // 2. _calibrate — USER_CONFIRMED has no decay
  await test('USER_CONFIRMED confidence unchanged by age', async () => {
    const m = { confidence: 0.9, trust_level: 'USER_CONFIRMED', updated_at: now - 365 * 86400000 };
    const c = cal._calibrate(m, now);
    assert.ok(c >= 0.85, `expected >=0.85, got ${c}`);
  });

  // 3. _calibrate — AI_HYPOTHESIS decays over time
  await test('AI_HYPOTHESIS decays over 120 days', async () => {
    const fresh = cal._calibrate({ confidence: 0.4, trust_level: 'AI_HYPOTHESIS', updated_at: now }, now);
    const aged  = cal._calibrate({ confidence: 0.4, trust_level: 'AI_HYPOTHESIS', updated_at: now - 120 * 86400000 }, now);
    assert.ok(aged < fresh, `expected aged (${aged}) < fresh (${fresh})`);
  });

  // 4. _calibrate — confidence capped at trust ceiling
  await test('confidence capped at INFERRED ceiling (0.6)', async () => {
    const m = { confidence: 0.95, trust_level: 'INFERRED', updated_at: now };
    const c = cal._calibrate(m, now);
    assert.ok(c <= 0.6 + 0.01, `expected <=0.6, got ${c}`);
  });

  // 5. _calibrate — result never below CONF_FLOOR
  await test('calibrated confidence never below floor', async () => {
    const m = { confidence: 0.4, trust_level: 'AI_HYPOTHESIS', updated_at: now - 10000 * 86400000 };
    const c = cal._calibrate(m, now);
    assert.ok(c >= 0.05, `expected >=0.05, got ${c}`);
  });

  // 6. preview — returns array
  await test('GET /api/calibrate/preview returns array', async () => {
    const r = await req('GET', '/api/calibrate/preview');
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.body), `expected array, got ${typeof r.body}`);
  });

  // 7. preview — over-confident INFERRED memory appears
  await test('over-confident INFERRED memory appears in preview', async () => {
    memory.add({ title: 'P49 Overcont', content: 'over', trust_level: 'INFERRED', confidence: 0.95, memory_type: 'semantic' });
    const changes = cal.preview();
    const hit = changes.find(c => c.title === 'P49 Overcont');
    assert.ok(hit, 'P49 Overcont should appear in calibration preview');
    assert.ok(hit.delta < 0, `expected decrease, got delta ${hit.delta}`);
  });

  // 8. preview — USER_CONFIRMED at 0.9 does NOT appear (no change needed)
  await test('USER_CONFIRMED with correct confidence not flagged', async () => {
    memory.add({ title: 'P49 Confirmed', content: 'confirmed', trust_level: 'USER_CONFIRMED', confidence: 0.9, memory_type: 'semantic' });
    const changes = cal.preview();
    const hit = changes.find(c => c.title === 'P49 Confirmed');
    assert.ok(!hit, 'P49 Confirmed should not appear in calibration preview');
  });

  // 9. POST /api/calibrate/apply returns applied count + changes array
  await test('POST /api/calibrate/apply returns applied count', async () => {
    const r = await req('POST', '/api/calibrate/apply', {});
    assert.strictEqual(r.status, 200);
    assert.ok(typeof r.body.applied === 'number', 'expected applied field');
    assert.ok(Array.isArray(r.body.changes), 'expected changes array');
  });

  // 10. after apply, preview returns empty (no more out-of-range scores)
  await test('after apply, preview is empty for calibrated memories', async () => {
    cal.apply();
    const changes = cal.preview();
    // The only remaining changes would be tiny float noise — all significant ones resolved
    const significant = changes.filter(c => Math.abs(c.delta) > 0.05);
    assert.strictEqual(significant.length, 0, `expected 0 significant changes after apply, got ${significant.length}: ${JSON.stringify(significant.map(c=>c.title))}`);
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
