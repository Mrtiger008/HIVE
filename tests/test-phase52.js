'use strict';
const assert = require('assert');
const path   = require('path');
const http   = require('http');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p52-${Date.now()}.db`);

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

async function run() {
  let passed = 0;
  const total = 10;
  async function test(name, fn) {
    try { await fn(); console.log(`  ✓ ${name}`); passed++; }
    catch (e) { console.log(`  ✗ ${name}: ${e.message}`); }
  }

  console.log('\nPhase 52 — Memory Templates UI\n');

  // 1. /api/templates returns an array
  await test('GET /api/templates returns an array', async () => {
    const r = await req('GET', '/api/templates');
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.body), 'expected array');
    assert.ok(r.body.length > 0, 'expected at least one template');
  });

  // 2. each template has required fields
  await test('each template has memory_type, trust_level, importance, confidence', async () => {
    const r = await req('GET', '/api/templates');
    for (const t of r.body) {
      assert.ok(t.memory_type,  `template missing memory_type`);
      assert.ok(t.trust_level,  `${t.memory_type} missing trust_level`);
      assert.ok(t.importance != null, `${t.memory_type} missing importance`);
      assert.ok(t.confidence != null, `${t.memory_type} missing confidence`);
    }
  });

  // 3. all 6 built-in types present
  await test('all 6 built-in template types are present', async () => {
    const r = await req('GET', '/api/templates');
    const types = new Set(r.body.map(t => t.memory_type));
    for (const t of ['semantic','core','domain','project','episodic','skill']) {
      assert.ok(types.has(t), `missing template: ${t}`);
    }
  });

  // 4. skill template has content_hint with scaffold
  await test('skill template content_hint contains step scaffold', async () => {
    const r = await req('GET', '/api/templates');
    const skill = r.body.find(t => t.memory_type === 'skill');
    assert.ok(skill, 'skill template not found');
    assert.ok(skill.content_hint && skill.content_hint.includes('Steps'), `skill content_hint missing: ${skill.content_hint}`);
  });

  // 5. core template has high importance (>=8) and USER_CONFIRMED trust
  await test('core template has importance>=8 and USER_CONFIRMED trust', async () => {
    const r = await req('GET', '/api/templates');
    const core = r.body.find(t => t.memory_type === 'core');
    assert.ok(core, 'core template not found');
    assert.ok(core.importance >= 8, `expected importance>=8, got ${core.importance}`);
    assert.strictEqual(core.trust_level, 'USER_CONFIRMED');
  });

  // 6. template tags field is an array
  await test('all templates have tags as an array', async () => {
    const r = await req('GET', '/api/templates');
    for (const t of r.body) {
      assert.ok(Array.isArray(t.tags), `${t.memory_type} tags is not an array`);
    }
  });

  // 7. skill template has 'howto' tag
  await test('skill template includes howto tag', async () => {
    const r = await req('GET', '/api/templates');
    const skill = r.body.find(t => t.memory_type === 'skill');
    assert.ok(skill.tags.includes('howto'), `expected howto tag, got ${JSON.stringify(skill.tags)}`);
  });

  // 8. confidence values are in 0–1 range
  await test('all template confidence values are in [0,1]', async () => {
    const r = await req('GET', '/api/templates');
    for (const t of r.body) {
      assert.ok(t.confidence >= 0 && t.confidence <= 1,
        `${t.memory_type} confidence out of range: ${t.confidence}`);
    }
  });

  // 9. importance values are in 1–10 range
  await test('all template importance values are in [1,10]', async () => {
    const r = await req('GET', '/api/templates');
    for (const t of r.body) {
      assert.ok(t.importance >= 1 && t.importance <= 10,
        `${t.memory_type} importance out of range: ${t.importance}`);
    }
  });

  // 10. HTML page contains tpl-chip class (chip picker is rendered)
  await test('dashboard HTML contains template chip picker markup', async () => {
    const r = await new Promise((resolve, reject) => {
      const opts = { hostname: '127.0.0.1', port: 7749, path: '/', method: 'GET' };
      const req2 = http.request(opts, res => {
        let raw = '';
        res.on('data', c => raw += c);
        res.on('end', () => resolve(raw));
      });
      req2.on('error', reject);
      req2.end();
    });
    assert.ok(r.includes('tpl-chip'), 'expected tpl-chip class in HTML');
    assert.ok(r.includes('nm-tpl-chips'), 'expected nm-tpl-chips element in HTML');
    assert.ok(r.includes('selectTemplate'), 'expected selectTemplate function in HTML');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
