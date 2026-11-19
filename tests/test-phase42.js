'use strict';
const assert = require('assert');
const path   = require('path');
const http   = require('http');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p42-${Date.now()}.db`);

const { SHORTCUTS } = require('../src/shortcuts');

function req(method, pathname, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = { hostname: '127.0.0.1', port: 7749, path: pathname, method,
      headers: { 'Content-Type': 'application/json', 'X-Hive-Local': '1',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } };
    const r = http.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        let b = null; try { b = raw ? JSON.parse(raw) : null; } catch { b = raw; }
        resolve({ status: res.statusCode, body: b });
      });
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

  console.log('\nPhase 42 — Keyboard Shortcuts\n');

  // 1. SHORTCUTS is a non-empty array
  await test('SHORTCUTS is a non-empty array', async () => {
    assert.ok(Array.isArray(SHORTCUTS) && SHORTCUTS.length > 0);
  });

  // 2. Every shortcut has key, guard, action, description
  await test('every shortcut has key, guard, action, description', async () => {
    for (const s of SHORTCUTS) {
      assert.ok(typeof s.key         === 'string' && s.key,         `missing key in ${JSON.stringify(s)}`);
      assert.ok(typeof s.guard       === 'string' && s.guard,       `missing guard in ${s.key}`);
      assert.ok(typeof s.action      === 'string' && s.action,      `missing action in ${s.key}`);
      assert.ok(typeof s.description === 'string' && s.description, `missing description in ${s.key}`);
    }
  });

  // 3. '/' shortcut exists (focus search)
  await test("'/' shortcut is defined (focus search)", async () => {
    const slash = SHORTCUTS.find(s => s.key === '/');
    assert.ok(slash, "No '/' shortcut found");
    assert.strictEqual(slash.action, 'focusSearch');
  });

  // 4. 'n' shortcut exists (new memory)
  await test("'n' shortcut is defined (new memory)", async () => {
    const n = SHORTCUTS.find(s => s.key === 'n');
    assert.ok(n, "No 'n' shortcut found");
    assert.strictEqual(n.action, 'newMemory');
  });

  // 5. 'Escape' shortcut exists (close modal)
  await test("'Escape' shortcut is defined (close all)", async () => {
    const esc = SHORTCUTS.find(s => s.key === 'Escape');
    assert.ok(esc, "No 'Escape' shortcut found");
    assert.strictEqual(esc.guard, 'always');
  });

  // 6. '?' shortcut exists (toggle help)
  await test("'?' shortcut is defined (toggle help)", async () => {
    const q = SHORTCUTS.find(s => s.key === '?');
    assert.ok(q, "No '?' shortcut found");
    assert.strictEqual(q.action, 'toggleHelp');
  });

  // 7. All notInput-guarded shortcuts don't include Escape
  await test('Escape has guard=always; navigation shortcuts have guard=notInput', async () => {
    const esc = SHORTCUTS.find(s => s.key === 'Escape');
    assert.strictEqual(esc.guard, 'always');
    const others = SHORTCUTS.filter(s => s.key !== 'Escape');
    for (const s of others) {
      assert.strictEqual(s.guard, 'notInput', `${s.key} should be notInput`);
    }
  });

  // 8. No duplicate keys
  await test('no duplicate shortcut keys', async () => {
    const keys = SHORTCUTS.map(s => s.key);
    const unique = new Set(keys);
    assert.strictEqual(unique.size, keys.length, `Duplicates found: ${keys}`);
  });

  // 9. API GET /api/shortcuts returns the shortcuts array
  await test('GET /api/shortcuts returns {shortcuts} array', async () => {
    const r = await req('GET', '/api/shortcuts');
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.body.shortcuts));
    assert.ok(r.body.shortcuts.length > 0);
  });

  // 10. API /api/shortcuts entries match SHORTCUTS module
  await test('API shortcuts match SHORTCUTS module definitions', async () => {
    const r = await req('GET', '/api/shortcuts');
    assert.strictEqual(r.body.shortcuts.length, SHORTCUTS.length);
    for (let i = 0; i < SHORTCUTS.length; i++) {
      assert.strictEqual(r.body.shortcuts[i].key,    SHORTCUTS[i].key);
      assert.strictEqual(r.body.shortcuts[i].action, SHORTCUTS[i].action);
    }
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
