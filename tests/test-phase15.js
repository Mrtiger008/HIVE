'use strict';
// HIVE Phase 15 — Project dashboard tests.
// Run: node tests/test-phase15.js

const assert = require('assert');
const path   = require('path');
const fs     = require('fs');
const http   = require('http');

const TEST_DB = path.join(__dirname, '..', 'database', 'hive-p15-test.db');
process.env.HIVE_DB = TEST_DB;

fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);

const memory   = require('../src/memory');
const projects = require('../src/projects');
const { createServer } = require('../src/server');
const { getDb, closeDb } = require('../src/db');

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✅  ${name}`); pass++; }
  catch (e) { console.error(`  ❌  ${name}\n      ${e.message}`); fail++; }
}

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}${urlPath}`, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

console.log('\nHIVE — Phase 15 project dashboard tests\n');

const srv = createServer();
srv.listen(0);
const port = srv.address().port;

// Seed a project + memories
const proj = projects.create({ name: 'Test Project', objective: 'Test objective', domain: 'engineering' });
memory.add({ title: 'P1 mem 1', content: 'First memory for test project.', project_id: proj.id });
memory.add({ title: 'P1 mem 2', content: 'Second memory for test project.', project_id: proj.id });
memory.add({ title: 'Orphan', content: 'No project assigned.' });

(async () => {

  // P-1: GET /api/projects returns the seeded project
  await test('P-1. GET /api/projects — lists seeded project', async () => {
    const r = await get(port, '/api/projects');
    assert.strictEqual(r.status, 200);
    const ps = JSON.parse(r.body);
    assert(Array.isArray(ps));
    assert(ps.some(p => p.id === proj.id), 'must include seeded project');
  });

  // P-2: GET /api/projects/:id/stats — returns project with counts
  await test('P-2. GET /api/projects/:id/stats — returns project + memory_count', async () => {
    const r = await get(port, `/api/projects/${proj.id}/stats`);
    assert.strictEqual(r.status, 200);
    const d = JSON.parse(r.body);
    assert.strictEqual(d.id, proj.id);
    assert.strictEqual(d.name, 'Test Project');
    assert('memory_count' in d, 'must have memory_count');
    assert('entity_count' in d, 'must have entity_count');
  });

  // P-3: memory_count reflects actual memories in project
  await test('P-3. /api/projects/:id/stats — memory_count is correct', async () => {
    const r = await get(port, `/api/projects/${proj.id}/stats`);
    const d = JSON.parse(r.body);
    assert.strictEqual(d.memory_count, 2, 'must count 2 active memories in project');
  });

  // P-4: entity_count is a non-negative integer
  await test('P-4. /api/projects/:id/stats — entity_count is non-negative integer', async () => {
    const r = await get(port, `/api/projects/${proj.id}/stats`);
    const d = JSON.parse(r.body);
    assert(typeof d.entity_count === 'number' && d.entity_count >= 0, 'entity_count must be >= 0');
  });

  // P-5: stats for unknown project returns 404
  await test('P-5. /api/projects/:id/stats — unknown project returns 404', async () => {
    const r = await get(port, '/api/projects/00000000-0000-0000-0000-000000000000/stats');
    assert.strictEqual(r.status, 404);
  });

  // P-6: archived memory not counted in stats
  await test('P-6. archived memory not counted in memory_count', async () => {
    // Archive one of the two project memories via the API
    const mems = JSON.parse((await get(port, `/api/memories?limit=50`)).body);
    const projMem = mems.find(m => m.project_id === proj.id);
    // Archive it directly through DB for simplicity
    getDb().prepare("UPDATE memories SET status='archived' WHERE id=?").run(projMem.id);
    const r = await get(port, `/api/projects/${proj.id}/stats`);
    const d = JSON.parse(r.body);
    assert.strictEqual(d.memory_count, 1, 'archived memory must not be counted');
    // Restore
    getDb().prepare("UPDATE memories SET status='active' WHERE id=?").run(projMem.id);
  });

  // P-7: Dashboard HTML contains projects tab element
  await test('P-7. GET / — HTML has projects tab', async () => {
    const r = await get(port, '/');
    assert(r.body.includes('id="projects"'), 'must include projects tab div');
    assert(r.body.includes('id="pl"'), 'must include projects list element');
  });

  // P-8: Dashboard HTML has Projects nav button
  await test('P-8. GET / — HTML has Projects nav button', async () => {
    const r = await get(port, '/');
    assert(r.body.includes("show('projects',this)"), 'must include projects nav button');
    assert(r.body.includes('>Projects<'), 'button must be labelled Projects');
  });

  // P-9: Dashboard HTML includes loadProjects function
  await test('P-9. GET / — HTML has loadProjects function', async () => {
    const r = await get(port, '/');
    assert(r.body.includes('loadProjects'), 'must include loadProjects');
    assert(r.body.includes('/api/projects/'), 'must call stats endpoint');
  });

  // P-10: Dashboard HTML includes viewProject function
  await test('P-10. GET / — HTML has viewProject function', async () => {
    const r = await get(port, '/');
    assert(r.body.includes('viewProject'), 'must include viewProject');
    assert(r.body.includes("g('mproj')"), 'must set mproj select');
  });

  // ── Cleanup ───────────────────────────────────────────────────────────────
  srv.close();
  closeDb();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  console.log(`\n${pass + fail} tests: ${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);

})();
