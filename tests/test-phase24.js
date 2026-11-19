'use strict';
// HIVE Phase 24 — Enhanced graph visualization tests.
// Run: node tests/test-phase24.js

const assert = require('assert');
const path   = require('path');
const fs     = require('fs');
const http   = require('http');

const TEST_DB = path.join(__dirname, '..', 'database', 'hive-p24-test.db');
process.env.HIVE_DB = TEST_DB;

fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);

const { getDb, closeDb } = require('../src/db');
const { createServer } = require('../src/server');

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

console.log('\nHIVE — Phase 24 enhanced graph tests\n');

const srv = createServer();
srv.listen(0);
const port = srv.address().port;

// Seed entities and a relationship
const db = getDb();
const { randomUUID } = require('crypto');
const now = Date.now();
const e1id = randomUUID(), e2id = randomUUID(), e3id = randomUUID();
db.prepare('INSERT INTO entities (id,name,entity_type,created_at) VALUES (?,?,?,?)')
  .run(e1id, 'Alice', 'person', now);
db.prepare('INSERT INTO entities (id,name,entity_type,created_at) VALUES (?,?,?,?)')
  .run(e2id, 'HIVE', 'tool', now+1);
db.prepare('INSERT INTO entities (id,name,entity_type,created_at) VALUES (?,?,?,?)')
  .run(e3id, 'Anthropic', 'org', now+2);
db.prepare('INSERT INTO relationships (id,from_id,rel_type,to_id,confidence,created_at) VALUES (?,?,?,?,?,?)')
  .run(randomUUID(), e1id, 'USES', e2id, 0.9, now);
db.prepare('INSERT INTO relationships (id,from_id,rel_type,to_id,confidence,created_at) VALUES (?,?,?,?,?,?)')
  .run(randomUUID(), e2id, 'MADE_BY', e3id, 0.95, now);

(async () => {

  // G-1: GET /api/graph returns nodes and edges
  await test('G-1. GET /api/graph — returns nodes and edges arrays', async () => {
    const r = await get(port, '/api/graph');
    assert.strictEqual(r.status, 200);
    const d = JSON.parse(r.body);
    assert(Array.isArray(d.nodes), 'must have nodes array');
    assert(Array.isArray(d.edges), 'must have edges array');
    assert(d.nodes.length >= 3, 'must have at least 3 seeded nodes');
  });

  // G-2: nodes have degree field
  await test('G-2. GET /api/graph — nodes include degree count', async () => {
    const r = await get(port, '/api/graph');
    const d = JSON.parse(r.body);
    assert(d.nodes.every(n => 'degree' in n), 'every node must have degree');
    const alice = d.nodes.find(n => n.name === 'Alice');
    assert(alice, 'Alice must be present');
    assert.strictEqual(alice.degree, 1, 'Alice has 1 edge (USES HIVE)');
    const hive = d.nodes.find(n => n.name === 'HIVE');
    assert.strictEqual(hive.degree, 2, 'HIVE has 2 edges (USES + MADE_BY)');
  });

  // G-3: GET /api/graph?type=person — filters by entity type
  await test('G-3. GET /api/graph?type=person — only person nodes', async () => {
    const r = await get(port, '/api/graph?type=person');
    const d = JSON.parse(r.body);
    assert(d.nodes.every(n => n.entity_type === 'person'), 'all nodes must be type person');
    assert(d.nodes.some(n => n.name === 'Alice'), 'Alice must appear');
    assert(!d.nodes.some(n => n.name === 'HIVE'), 'HIVE (tool) must be excluded');
  });

  // G-4: GET /api/graph?search=ali — filters by name
  await test('G-4. GET /api/graph?search=ali — name substring filter', async () => {
    const r = await get(port, '/api/graph?search=ali');
    const d = JSON.parse(r.body);
    assert(d.nodes.every(n => n.name.toLowerCase().includes('ali')), 'all results must match search');
    assert(d.nodes.some(n => n.name === 'Alice'), 'Alice must appear');
  });

  // G-5: search is case-insensitive
  await test('G-5. GET /api/graph?search=ALICE — case-insensitive', async () => {
    const r = await get(port, '/api/graph?search=ALICE');
    const d = JSON.parse(r.body);
    assert(d.nodes.some(n => n.name === 'Alice'), 'Alice must appear for uppercase search');
  });

  // G-6: type + search can be combined
  await test('G-6. GET /api/graph?type=tool&search=hive — combined filter', async () => {
    const r = await get(port, '/api/graph?type=tool&search=hive');
    const d = JSON.parse(r.body);
    assert(d.nodes.every(n => n.entity_type === 'tool'), 'all must be type tool');
    assert(d.nodes.some(n => n.name === 'HIVE'), 'HIVE must appear');
  });

  // G-7: edges only include nodes present in the filtered node set
  await test('G-7. GET /api/graph?type=person — edges only cross filtered nodes', async () => {
    const r = await get(port, '/api/graph?type=person');
    const d = JSON.parse(r.body);
    const ids = new Set(d.nodes.map(n => n.id));
    assert(d.edges.every(e => ids.has(e.from_id) && ids.has(e.to_id)),
      'all edge endpoints must be in the node set');
  });

  // G-8: edges include rel_type
  await test('G-8. GET /api/graph — edges have rel_type', async () => {
    const r = await get(port, '/api/graph');
    const d = JSON.parse(r.body);
    assert(d.edges.length > 0, 'must have edges');
    assert(d.edges.every(e => e.rel_type), 'every edge must have rel_type');
    assert(d.edges.some(e => e.rel_type === 'USES'), 'USES edge must be present');
  });

  // G-9: dashboard HTML has graph controls (search, type, fit button)
  await test('G-9. GET / — HTML has graph search, type filter and fit button', async () => {
    const r = await get(port, '/');
    assert(r.body.includes('id="g-search"'),  'must have g-search input');
    assert(r.body.includes('id="g-type"'),    'must have g-type select');
    assert(r.body.includes('fitGraph'),        'must include fitGraph function');
    assert(r.body.includes('id="g-count"'),   'must have node/edge count span');
  });

  // G-10: dashboard HTML has tooltip, info panel, and enhanced graph features
  await test('G-10. GET / — HTML has tooltip, info panel, edge labels, degree-based sizing', async () => {
    const r = await get(port, '/');
    assert(r.body.includes('id="g-tip"'),      'must have tooltip element');
    assert(r.body.includes('id="g-info"'),     'must have info panel element');
    assert(r.body.includes('rel_type'),         'edge label rendering must reference rel_type');
    assert(r.body.includes('n.degree'),         'node sizing must use degree');
    assert(r.body.includes('neighOf'),          'subgraph highlight must use neighOf');
  });

  // ── Cleanup ───────────────────────────────────────────────────────────────
  srv.close();
  closeDb();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  console.log(`\n${pass + fail} tests: ${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);

})();
