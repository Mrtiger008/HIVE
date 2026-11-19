'use strict';
// HIVE Phase 11 — Graph visualization API tests.
// Run: node tests/test-phase11.js

const assert = require('assert');
const path   = require('path');
const fs     = require('fs');
const http   = require('http');

const TEST_DB = path.join(__dirname, '..', 'database', 'hive-p11-test.db');
process.env.HIVE_DB = TEST_DB;

fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);

const entities = require('../src/entities');
const graph    = require('../src/graph');
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
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    }).on('error', reject);
  });
}

console.log('\nHIVE — Phase 11 graph API tests\n');

const srv = createServer();
srv.listen(0);
const port = srv.address().port;

(async () => {

  // G-1: GET /api/graph returns { nodes, edges } shape on empty DB
  await test('G-1. GET /api/graph — returns { nodes, edges } when empty', async () => {
    const r = await get(port, '/api/graph');
    assert.strictEqual(r.status, 200);
    assert(Array.isArray(r.body.nodes), 'nodes must be array');
    assert(Array.isArray(r.body.edges), 'edges must be array');
  });

  // G-2: Empty DB → empty nodes and edges
  await test('G-2. GET /api/graph — empty DB returns no nodes or edges', async () => {
    const r = await get(port, '/api/graph');
    assert.strictEqual(r.body.nodes.length, 0, `expected 0 nodes, got ${r.body.nodes.length}`);
    assert.strictEqual(r.body.edges.length, 0, `expected 0 edges, got ${r.body.edges.length}`);
  });

  // Seed entities and a relationship
  const e1 = entities.create({ name: 'GraphNode Alpha', entity_type: 'tool' });
  const e2 = entities.create({ name: 'GraphNode Beta',  entity_type: 'concept' });
  const e3 = entities.create({ name: 'GraphNode Gamma', entity_type: 'person' });
  graph.link({ from_id: e1.id, rel_type: 'USES', to_id: e2.id, confidence: 0.9 });
  graph.link({ from_id: e2.id, rel_type: 'PART_OF', to_id: e3.id, confidence: 0.7 });

  // G-3: After seeding, nodes appear
  await test('G-3. GET /api/graph — entities appear as nodes', async () => {
    const r = await get(port, '/api/graph');
    assert(r.body.nodes.length >= 3, `expected >= 3 nodes, got ${r.body.nodes.length}`);
    const names = r.body.nodes.map(n => n.name);
    assert(names.includes('GraphNode Alpha'), 'Alpha must appear');
    assert(names.includes('GraphNode Beta'),  'Beta must appear');
  });

  // G-4: Relationships appear as edges
  await test('G-4. GET /api/graph — relationships appear as edges', async () => {
    const r = await get(port, '/api/graph');
    assert(r.body.edges.length >= 2, `expected >= 2 edges, got ${r.body.edges.length}`);
    const edge = r.body.edges.find(e => e.from_id === e1.id && e.to_id === e2.id);
    assert(edge, 'Alpha→Beta USES edge must appear');
    assert.strictEqual(edge.rel_type, 'USES');
  });

  // G-5: Node fields include id, name, entity_type
  await test('G-5. GET /api/graph — nodes have required fields', async () => {
    const r = await get(port, '/api/graph');
    for (const n of r.body.nodes) {
      assert(n.id,          `node missing id: ${JSON.stringify(n)}`);
      assert(n.name,        `node missing name: ${JSON.stringify(n)}`);
      assert(n.entity_type, `node missing entity_type: ${JSON.stringify(n)}`);
    }
  });

  // G-6: Edge fields include from_id, to_id, rel_type
  await test('G-6. GET /api/graph — edges have required fields', async () => {
    const r = await get(port, '/api/graph');
    for (const e of r.body.edges) {
      assert(e.from_id,  `edge missing from_id: ${JSON.stringify(e)}`);
      assert(e.to_id,    `edge missing to_id: ${JSON.stringify(e)}`);
      assert(e.rel_type, `edge missing rel_type: ${JSON.stringify(e)}`);
    }
  });

  // G-7: Edges only reference nodes in the returned set
  await test('G-7. GET /api/graph — all edge endpoints are in the nodes set', async () => {
    const r = await get(port, '/api/graph');
    const nodeIds = new Set(r.body.nodes.map(n => n.id));
    for (const e of r.body.edges) {
      assert(nodeIds.has(e.from_id), `edge from_id ${e.from_id} not in nodes`);
      assert(nodeIds.has(e.to_id),   `edge to_id ${e.to_id} not in nodes`);
    }
  });

  // G-8: limit parameter restricts nodes returned
  await test('G-8. GET /api/graph?limit=1 — respects limit', async () => {
    const r = await get(port, '/api/graph?limit=1');
    assert.strictEqual(r.body.nodes.length, 1, `expected 1 node, got ${r.body.nodes.length}`);
  });

  // G-9: entity_type values are valid known types
  await test('G-9. GET /api/graph — entity_type values are valid', async () => {
    const VALID = new Set(['person','tool','org','concept','project','file','domain','other']);
    const r = await get(port, '/api/graph');
    for (const n of r.body.nodes) {
      assert(VALID.has(n.entity_type), `unknown entity_type: ${n.entity_type}`);
    }
  });

  // G-10: HTML dashboard includes the Graph tab
  await test('G-10. GET / — HTML contains Graph tab', async () => {
    const r2 = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}/`, res => {
        let body = '';
        res.on('data', c => { body += c; });
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }).on('error', reject);
    });
    assert(r2.body.includes('Graph'), 'HTML must include "Graph" tab');
    assert(r2.body.includes('/api/graph'), 'HTML must reference /api/graph endpoint');
  });

  // ── Cleanup ───────────────────────────────────────────────────────────────
  srv.close();
  closeDb();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  console.log(`\n${pass + fail} tests: ${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);

})();
