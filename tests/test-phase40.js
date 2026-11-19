'use strict';
const assert = require('assert');
const path   = require('path');
const http   = require('http');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p40-${Date.now()}.db`);

const memory   = require('../src/memory');
const clusters = require('../src/clusters');

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

  console.log('\nPhase 40 — Memory Clusters\n');

  // 1. get() returns {clusters, unclustered}
  await test('get() returns {clusters, unclustered}', async () => {
    const d = clusters.get();
    assert.ok(Array.isArray(d.clusters));
    assert.ok(Array.isArray(d.unclustered));
  });

  // 2. Empty DB → no clusters
  await test('empty DB returns no clusters', async () => {
    const d = clusters.get();
    assert.strictEqual(d.clusters.length, 0);
  });

  // 3. Memories sharing tags form a cluster
  await test('memories sharing ≥2 tags are grouped into a cluster', async () => {
    memory.add({ title: 'JS basics',   content: 'C', memory_type: 'skill',    tags: ['javascript', 'programming'] });
    memory.add({ title: 'JS promises', content: 'C', memory_type: 'semantic', tags: ['javascript', 'programming', 'async'] });
    memory.add({ title: 'JS closures', content: 'C', memory_type: 'semantic', tags: ['javascript', 'programming'] });
    const d = clusters.get({ minShared: 2 });
    assert.ok(d.clusters.length >= 1, 'expected at least 1 cluster');
    const c = d.clusters[0];
    assert.ok(c.size >= 3, `cluster size should be >=3, got ${c.size}`);
  });

  // 4. Each cluster has required fields
  await test('each cluster has label, size, top_tags, members', async () => {
    const d = clusters.get({ minShared: 2 });
    for (const c of d.clusters) {
      assert.ok(typeof c.label === 'string' && c.label.length > 0);
      assert.ok(typeof c.size === 'number' && c.size >= 2);
      assert.ok(Array.isArray(c.top_tags) && c.top_tags.length > 0);
      assert.ok(Array.isArray(c.members));
    }
  });

  // 5. Clusters sorted by size descending
  await test('clusters sorted by size descending', async () => {
    // Add a small cluster (2 memories)
    memory.add({ title: 'Python A', content: 'C', memory_type: 'skill',    tags: ['python', 'scripting'] });
    memory.add({ title: 'Python B', content: 'C', memory_type: 'semantic', tags: ['python', 'scripting'] });
    const d = clusters.get({ minShared: 2 });
    for (let i = 1; i < d.clusters.length; i++) {
      assert.ok(d.clusters[i-1].size >= d.clusters[i].size,
        `cluster[${i-1}].size(${d.clusters[i-1].size}) < cluster[${i}].size(${d.clusters[i].size})`);
    }
  });

  // 6. Memory with no tags goes to unclustered
  await test('memory with no tags is unclustered', async () => {
    memory.add({ title: 'No tags', content: 'C', memory_type: 'episodic', tags: [] });
    const d = clusters.get();
    assert.ok(d.unclustered.some(m => m.title === 'No tags'), 'untagged memory should be unclustered');
  });

  // 7. top_tags contains the shared tags
  await test('top_tags includes the shared tags', async () => {
    const d = clusters.get({ minShared: 2 });
    const jsCluster = d.clusters.find(c => c.top_tags.includes('javascript'));
    assert.ok(jsCluster, 'expected cluster with javascript tag');
    assert.ok(jsCluster.top_tags.includes('programming'), 'expected programming in top_tags');
  });

  // 8. minShared=3 produces smaller/no clusters when less overlap
  await test('higher minShared threshold can reduce cluster count', async () => {
    const low  = clusters.get({ minShared: 1 });
    const high = clusters.get({ minShared: 3 });
    assert.ok(low.clusters.length >= high.clusters.length,
      `minShared=1(${low.clusters.length}) should be >= minShared=3(${high.clusters.length})`);
  });

  // 9. Archived memory is excluded from clusters
  await test('archived memory is excluded from clusters', async () => {
    const m = memory.add({ title: 'Archived', content: 'C', memory_type: 'semantic', tags: ['javascript', 'programming'] });
    memory.update(m.id, { status: 'archived' });
    const d = clusters.get({ minShared: 2 });
    const inCluster = d.clusters.flatMap(c => c.members).some(x => x.id === m.id);
    const inUnclustered = d.unclustered.some(x => x.id === m.id);
    assert.ok(!inCluster && !inUnclustered, 'archived memory should not appear anywhere');
  });

  // 10. API GET /api/clusters returns expected shape
  await test('GET /api/clusters returns {clusters, unclustered}', async () => {
    const r = await req('GET', '/api/clusters?min_shared=2');
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.body.clusters));
    assert.ok(Array.isArray(r.body.unclustered));
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
