'use strict';
const assert = require('assert');
const http   = require('http');
const path   = require('path');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p68-${Date.now()}.db`);

function req(method, pathname, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = { hostname: '127.0.0.1', port: 7749, path: pathname, method,
                   headers: { 'X-Hive-Local': '1', ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) } };
    const r = http.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => { let b; try { b = JSON.parse(raw); } catch { b = raw; } resolve({ status: res.statusCode, body: b }); });
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

  console.log('\nPhase 68 — Search Export\n');

  // Seed two memories with a distinctive keyword
  const { body: m1 } = await req('POST', '/api/memories', { title: 'Quantum physics intro', content: 'quantumfoo entanglement superposition', memory_type: 'domain' });
  const { body: m2 } = await req('POST', '/api/memories', { title: 'Quantum computing basics', content: 'quantumfoo qubits gates', memory_type: 'domain' });

  const html = (await req('GET', '/')).body;

  // 1. dashboard has #sr-csv-btn element
  await test('dashboard has #sr-csv-btn button', async () => {
    assert.ok(html.includes('sr-csv-btn'), 'expected sr-csv-btn in HTML');
  });

  // 2. CSV button initially hidden (display:none)
  await test('sr-csv-btn starts hidden', async () => {
    assert.ok(html.includes('sr-csv-btn') && html.includes('display:none'), 'expected display:none on sr-csv-btn');
  });

  // 3. dashboard has exportSearchCsv function
  await test('dashboard has exportSearchCsv function', async () => {
    assert.ok(html.includes('exportSearchCsv'), 'expected exportSearchCsv in HTML');
  });

  // 4. dashboard has _srResults variable
  await test('dashboard has _srResults variable', async () => {
    assert.ok(html.includes('_srResults'), 'expected _srResults in HTML');
  });

  // 5. /api/export?format=csv&ids= with valid IDs returns CSV
  await test('/api/export?format=csv&ids=... returns CSV content-type', async () => {
    const opts = { hostname: '127.0.0.1', port: 7749, path: `/api/export?format=csv&ids=${m1.id},${m2.id}`, method: 'GET', headers: { 'X-Hive-Local': '1' } };
    const { status, headers } = await new Promise((resolve, reject) => {
      const r = http.request(opts, res => {
        let raw = ''; res.on('data', c => raw += c);
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: raw }));
      });
      r.on('error', reject); r.end();
    });
    assert.strictEqual(status, 200);
    assert.ok((headers['content-type']||'').includes('text/csv'), 'expected text/csv');
  });

  // 6. CSV export contains both memory titles
  await test('CSV export contains both memory titles', async () => {
    const opts = { hostname: '127.0.0.1', port: 7749, path: `/api/export?format=csv&ids=${m1.id},${m2.id}`, method: 'GET', headers: { 'X-Hive-Local': '1' } };
    const csv = await new Promise((resolve, reject) => {
      const r = http.request(opts, res => { let raw=''; res.on('data',c=>raw+=c); res.on('end',()=>resolve(raw)); });
      r.on('error', reject); r.end();
    });
    assert.ok(csv.includes('Quantum physics intro'), 'expected first title in CSV');
    assert.ok(csv.includes('Quantum computing basics'), 'expected second title in CSV');
  });

  // 7. CSV export with single ID works
  await test('CSV export with single ID works', async () => {
    const opts = { hostname: '127.0.0.1', port: 7749, path: `/api/export?format=csv&ids=${m1.id}`, method: 'GET', headers: { 'X-Hive-Local': '1' } };
    const csv = await new Promise((resolve, reject) => {
      const r = http.request(opts, res => { let raw=''; res.on('data',c=>raw+=c); res.on('end',()=>resolve(raw)); });
      r.on('error', reject); r.end();
    });
    assert.ok(csv.includes('Quantum physics intro'), 'expected title in single-ID CSV');
    assert.ok(!csv.includes('Quantum computing basics'), 'second title should not appear');
  });

  // 8. CSV export with unknown IDs returns empty-but-valid CSV (just header)
  await test('CSV export with unknown IDs returns header-only CSV', async () => {
    const opts = { hostname: '127.0.0.1', port: 7749, path: '/api/export?format=csv&ids=nonexistent-id', method: 'GET', headers: { 'X-Hive-Local': '1' } };
    const { status, csv } = await new Promise((resolve, reject) => {
      const r = http.request(opts, res => { let raw=''; res.on('data',c=>raw+=c); res.on('end',()=>resolve({status:res.statusCode,csv:raw})); });
      r.on('error', reject); r.end();
    });
    assert.strictEqual(status, 200);
    assert.ok(csv.length > 0, 'expected at least a CSV header row');
  });

  // 9. doSearch stores results in _srResults (checked via HTML structure)
  await test('doSearch assigns _srResults after fetch', async () => {
    // Verify the assignment pattern exists in HTML source
    assert.ok(html.includes('_srResults = d'), 'expected _srResults = d assignment in doSearch');
  });

  // 10. CSV button appears with ⬇ CSV label
  await test('CSV button has ⬇ CSV label text', async () => {
    assert.ok(html.includes('⬇ CSV'), 'expected ⬇ CSV text on button');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
