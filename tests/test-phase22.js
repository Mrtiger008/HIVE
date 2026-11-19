'use strict';
// HIVE Phase 22 — API key authentication tests.
// Run: node tests/test-phase22.js

const assert = require('assert');
const path   = require('path');
const fs     = require('fs');
const http   = require('http');

const TEST_DB = path.join(__dirname, '..', 'database', 'hive-p22-test.db');
process.env.HIVE_DB = TEST_DB;

fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);

const { closeDb } = require('../src/db');
const apikeys     = require('../src/apikeys');
const { createServer } = require('../src/server');

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✅  ${name}`); pass++; }
  catch (e) { console.error(`  ❌  ${name}\n      ${e.message}`); fail++; }
}

function get(port, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path: urlPath, headers }, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

function post(port, urlPath, payload, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = http.request({
      hostname: '127.0.0.1', port, path: urlPath, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers },
    }, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    });
    req.on('error', reject);
    req.write(data); req.end();
  });
}

function del(port, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: urlPath, method: 'DELETE', headers }, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    });
    req.on('error', reject);
    req.end();
  });
}

console.log('\nHIVE — Phase 22 API key authentication tests\n');

const srv = createServer();
srv.listen(0);
const port = srv.address().port;

(async () => {

  // K-1: open mode — no keys exist, /api/stats accessible without auth
  await test('K-1. Open mode — /api/stats accessible without auth when no keys exist', async () => {
    const r = await get(port, '/api/stats');
    assert.strictEqual(r.status, 200);
    const d = JSON.parse(r.body);
    assert('memories' in d, 'must return stats object');
  });

  // K-2: generate a key via module
  let generatedKey;
  await test('K-2. apikeys.generate returns a hive_ prefixed key', () => {
    generatedKey = apikeys.generate('test-tool');
    assert(generatedKey.startsWith('hive_'), 'key must start with hive_');
    assert(generatedKey.length > 20, 'key must be long');
  });

  // K-3: verify — valid key returns true
  await test('K-3. apikeys.verify — valid key returns true', () => {
    assert(apikeys.verify(generatedKey), 'valid key must verify');
  });

  // K-4: verify — wrong key returns false
  await test('K-4. apikeys.verify — wrong key returns false', () => {
    assert(!apikeys.verify('hive_wrongkey'), 'wrong key must not verify');
    assert(!apikeys.verify(''), 'empty string must not verify');
    assert(!apikeys.verify(null), 'null must not verify');
  });

  // K-5: once a key exists, unauthenticated /api/stats returns 401
  await test('K-5. Auth mode — /api/stats returns 401 without token', async () => {
    const r = await get(port, '/api/stats');
    assert.strictEqual(r.status, 401, 'must require auth once keys exist');
  });

  // K-6: authenticated request with valid Bearer token succeeds
  await test('K-6. Auth mode — valid Bearer token passes', async () => {
    const r = await get(port, '/api/stats', { 'Authorization': `Bearer ${generatedKey}` });
    assert.strictEqual(r.status, 200);
  });

  // K-7: X-Hive-Local bypass works (dashboard fetches)
  await test('K-7. X-Hive-Local: 1 bypasses auth (dashboard fetches)', async () => {
    const r = await get(port, '/api/stats', { 'X-Hive-Local': '1' });
    assert.strictEqual(r.status, 200);
  });

  // K-8: GET / (dashboard) is never gated by auth (not an /api/ route)
  await test('K-8. GET / (dashboard) is not gated by auth', async () => {
    const r = await get(port, '/');
    assert.strictEqual(r.status, 200);
    assert(r.body.includes('HIVE'), 'must return dashboard HTML');
  });

  // K-9: GET /api/apikeys lists keys (with X-Hive-Local)
  await test('K-9. GET /api/apikeys — lists keys', async () => {
    const r = await get(port, '/api/apikeys', { 'X-Hive-Local': '1' });
    assert.strictEqual(r.status, 200);
    const ks = JSON.parse(r.body);
    assert(Array.isArray(ks), 'must return array');
    assert(ks.some(k => k.name === 'test-tool'), 'must include test-tool key');
  });

  // K-10: revoke via apikeys.revoke, then key no longer verifies
  await test('K-10. apikeys.revoke — revoked key fails verify', () => {
    const changes = apikeys.revoke('test-tool');
    assert.strictEqual(changes, 1, 'must report 1 deletion');
    assert(!apikeys.verify(generatedKey), 'revoked key must not verify');
  });

  // ── Cleanup ───────────────────────────────────────────────────────────────
  srv.close();
  closeDb();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  console.log(`\n${pass + fail} tests: ${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);

})();
