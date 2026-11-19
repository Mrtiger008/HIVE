'use strict';
// HIVE Phase 9 — Web Dashboard / HTTP server tests.
// Run: node tests/test-server.js

const assert = require('assert');
const path   = require('path');
const fs     = require('fs');
const http   = require('http');

const TEST_DB = path.join(__dirname, '..', 'database', 'hive-server-test.db');
process.env.HIVE_DB = TEST_DB;

fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);

const memory   = require('../src/memory');
const entities = require('../src/entities');
const projects = require('../src/projects');
const { createServer } = require('../src/server');
const { getDb, closeDb } = require('../src/db');

let pass = 0, fail = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✅  ${name}`); pass++;
  } catch (e) { console.error(`  ❌  ${name}\n      ${e.message}`); fail++; }
}
async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`  ✅  ${name}`); pass++;
  } catch (e) { console.error(`  ❌  ${name}\n      ${e.message}`); fail++; }
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}${urlPath}`, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on('error', reject);
  });
}

// ── Seed data ─────────────────────────────────────────────────────────────────

memory.add({ title: 'Server test memory A', content: 'Content about SQLite', memory_type: 'semantic', trust_level: 'OBSERVED', importance: 5 });
memory.add({ title: 'Server test memory B', content: 'Content about Node.js', memory_type: 'core', trust_level: 'USER_CONFIRMED', importance: 8 });
entities.create({ name: 'TestEntity', entity_type: 'tool' });
const proj = projects.create({ name: 'Server Test Project', domain: 'engineering' });

// ── Spin up server ────────────────────────────────────────────────────────────

console.log('\nHIVE — Phase 9 web dashboard tests\n');

const srv = createServer();
srv.listen(0); // OS-assigned port
const port = srv.address().port;

(async () => {

  // W-1: GET / returns HTML
  await testAsync('W-1. GET / — returns HTML page', async () => {
    const r = await get(port, '/');
    assert.strictEqual(r.status, 200, `expected 200, got ${r.status}`);
    assert(r.headers['content-type'].includes('text/html'), 'must be text/html');
    assert(r.body.includes('<html'), 'body must contain <html');
    assert(r.body.includes('HIVE'), 'body must mention HIVE');
  });

  // W-2: GET /api/stats returns memory/entity/project counts
  await testAsync('W-2. GET /api/stats — returns counts', async () => {
    const r = await get(port, '/api/stats');
    assert.strictEqual(r.status, 200);
    assert(r.headers['content-type'].includes('application/json'), 'must be JSON');
    const data = JSON.parse(r.body);
    assert(typeof data.memories === 'number', 'must have memories count');
    assert(typeof data.entities === 'number', 'must have entities count');
    assert(typeof data.projects === 'number', 'must have projects count');
    assert(data.memories >= 2, `expected >= 2 memories, got ${data.memories}`);
    assert(data.entities >= 1, `expected >= 1 entities, got ${data.entities}`);
  });

  // W-3: GET /api/memories returns array
  await testAsync('W-3. GET /api/memories — returns memory list', async () => {
    const r = await get(port, '/api/memories');
    assert.strictEqual(r.status, 200);
    const data = JSON.parse(r.body);
    assert(Array.isArray(data), 'must return array');
    assert(data.length >= 2, `expected >= 2, got ${data.length}`);
    assert(data[0].title, 'each memory must have a title');
  });

  // W-4: GET /api/memories?type=core returns only core memories
  await testAsync('W-4. GET /api/memories?type=core — filters by type', async () => {
    const r = await get(port, '/api/memories?type=core');
    assert.strictEqual(r.status, 200);
    const data = JSON.parse(r.body);
    assert(Array.isArray(data));
    assert(data.every(m => m.memory_type === 'core'), 'all returned memories must be type=core');
  });

  // W-5: GET /api/search?q=SQLite returns matches
  await testAsync('W-5. GET /api/search?q=SQLite — returns search results', async () => {
    const r = await get(port, '/api/search?q=SQLite');
    assert.strictEqual(r.status, 200);
    const data = JSON.parse(r.body);
    assert(Array.isArray(data));
    assert(data.length >= 1, `expected >= 1 match for "SQLite", got ${data.length}`);
  });

  // W-6: GET /api/search with empty q returns empty array (not error)
  await testAsync('W-6. GET /api/search?q= — empty query returns []', async () => {
    const r = await get(port, '/api/search?q=');
    assert.strictEqual(r.status, 200);
    const data = JSON.parse(r.body);
    assert(Array.isArray(data) && data.length === 0, 'empty query must return empty array');
  });

  // W-7: GET /api/entities returns entity list
  await testAsync('W-7. GET /api/entities — returns entity list', async () => {
    const r = await get(port, '/api/entities');
    assert.strictEqual(r.status, 200);
    const data = JSON.parse(r.body);
    assert(Array.isArray(data));
    assert(data.length >= 1, `expected >= 1, got ${data.length}`);
    assert(data.some(e => e.name === 'TestEntity'), 'TestEntity must appear');
    assert(Array.isArray(data[0].aliases), 'aliases must be an array');
  });

  // W-8: GET /api/projects returns project list
  await testAsync('W-8. GET /api/projects — returns project list', async () => {
    const r = await get(port, '/api/projects');
    assert.strictEqual(r.status, 200);
    const data = JSON.parse(r.body);
    assert(Array.isArray(data));
    assert(data.some(p => p.name === 'Server Test Project'), 'Server Test Project must appear');
  });

  // W-9: GET /api/patterns returns array
  await testAsync('W-9. GET /api/patterns — returns keyword patterns', async () => {
    const r = await get(port, '/api/patterns?days=30&limit=10');
    assert.strictEqual(r.status, 200);
    const data = JSON.parse(r.body);
    assert(Array.isArray(data), 'must return array');
  });

  // W-10: unknown route returns 404
  await testAsync('W-10. Unknown route — returns 404', async () => {
    const r = await get(port, '/api/doesnotexist');
    assert.strictEqual(r.status, 404, `expected 404, got ${r.status}`);
  });

  // ── Cleanup ───────────────────────────────────────────────────────────────
  srv.close();
  closeDb();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  console.log(`\n${pass + fail} tests: ${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);

})();
