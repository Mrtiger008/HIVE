'use strict';
const assert = require('assert');
const path   = require('path');
const http   = require('http');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p38-${Date.now()}.db`);

const memory   = require('../src/memory');
const links    = require('../src/links');
const memgraph = require('../src/memgraph');

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

  console.log('\nPhase 38 — Memory Relations Graph\n');

  // 1. build() returns {nodes, edges} structure
  await test('build() returns {nodes, edges}', async () => {
    const g = memgraph.build();
    assert.ok(Array.isArray(g.nodes));
    assert.ok(Array.isArray(g.edges));
  });

  // 2. build() with no memories returns empty arrays
  await test('build() with no memories returns empty arrays', async () => {
    const g = memgraph.build();
    assert.strictEqual(g.nodes.length, 0);
    assert.strictEqual(g.edges.length, 0);
  });

  // 3. Active memory appears as a node
  await test('active memory appears as node with correct fields', async () => {
    const m = memory.add({ title: 'Graph node', content: 'Test', memory_type: 'semantic', importance: 7 });
    const g = memgraph.build();
    const node = g.nodes.find(n => n.id === m.id);
    assert.ok(node, 'node should exist');
    assert.strictEqual(node.label, m.title);
    assert.strictEqual(node.type, 'semantic');
    assert.ok(typeof node.size === 'number');
    assert.ok(typeof node.color === 'string');
  });

  // 4. Node size scales with importance
  await test('node size scales with importance', async () => {
    const lo = memory.add({ title: 'Low imp',  content: 'C', memory_type: 'episodic', importance: 1 });
    const hi = memory.add({ title: 'High imp', content: 'C', memory_type: 'episodic', importance: 10 });
    const g = memgraph.build();
    const nLo = g.nodes.find(n => n.id === lo.id);
    const nHi = g.nodes.find(n => n.id === hi.id);
    assert.ok(nHi.size > nLo.size, `high-imp(${nHi.size}) should be > low-imp(${nLo.size})`);
  });

  // 5. TYPE_COLORS exported and covers all 6 memory types
  await test('TYPE_COLORS covers all 6 memory types', async () => {
    const types = ['core','domain','project','episodic','semantic','skill'];
    for (const t of types) assert.ok(memgraph.TYPE_COLORS[t], `missing color for ${t}`);
  });

  // 6. EDGE_COLORS exported and covers standard rel types
  await test('EDGE_COLORS covers standard relationship types', async () => {
    const rels = ['related','supports','contradicts','supersedes','predecessor','see-also'];
    for (const r of rels) assert.ok(memgraph.EDGE_COLORS[r], `missing color for ${r}`);
  });

  // 7. Link between two memories appears as edge
  await test('link between two active memories appears as edge', async () => {
    const a = memory.add({ title: 'Edge A', content: 'C', memory_type: 'core' });
    const b = memory.add({ title: 'Edge B', content: 'C', memory_type: 'core' });
    links.add(a.id, 'related', b.id, 'test edge');
    const g = memgraph.build();
    const edge = g.edges.find(e => e.from === a.id && e.to === b.id);
    assert.ok(edge, 'edge should exist');
    assert.strictEqual(edge.rel_type, 'related');
    assert.ok(typeof edge.color === 'string');
  });

  // 8. Archived memory does not appear as node
  await test('archived memory is excluded from graph nodes', async () => {
    const m = memory.add({ title: 'To archive', content: 'C', memory_type: 'semantic' });
    memory.update(m.id, { status: 'archived' });
    const g = memgraph.build();
    assert.ok(!g.nodes.find(n => n.id === m.id), 'archived memory should not be in nodes');
  });

  // 9. Edge between active and archived memory is excluded
  await test('edge involving archived memory is excluded', async () => {
    const active   = memory.add({ title: 'Active mem', content: 'C', memory_type: 'core' });
    const archived = memory.add({ title: 'Archived',   content: 'C', memory_type: 'core' });
    links.add(active.id, 'related', archived.id);
    memory.update(archived.id, { status: 'archived' });
    const g = memgraph.build();
    const edge = g.edges.find(e =>
      (e.from === active.id && e.to === archived.id) ||
      (e.from === archived.id && e.to === active.id)
    );
    assert.ok(!edge, 'edge to archived memory should be excluded');
  });

  // 10. API GET /api/memories/graph returns nodes and edges
  await test('GET /api/memories/graph returns {nodes, edges}', async () => {
    const r = await req('GET', '/api/memories/graph');
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.body.nodes));
    assert.ok(Array.isArray(r.body.edges));
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
