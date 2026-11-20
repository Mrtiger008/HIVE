'use strict';
const assert = require('assert');
const http   = require('http');
const path   = require('path');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p65-${Date.now()}.db`);

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
      res.on('end', () => resolve({ status: res.statusCode, body: raw, headers: res.headers }));
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

async function add(title) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ title, content: 'content for ' + title, memory_type: 'semantic' });
    const opts = {
      hostname: '127.0.0.1', port: 7749, path: '/api/memories', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Hive-Local': '1', 'Content-Length': Buffer.byteLength(payload) },
    };
    const r = http.request(opts, res => {
      let raw = ''; res.on('data', c => raw += c); res.on('end', () => resolve(JSON.parse(raw)));
    });
    r.on('error', reject); r.write(payload); r.end();
  });
}

function csvExport(qs) {
  return req('GET', '/api/export?format=csv' + (qs ? '&' + qs : ''));
}

async function run() {
  let passed = 0;
  const total = 10;
  async function test(name, fn) {
    try { await fn(); console.log(`  ✓ ${name}`); passed++; }
    catch (e) { console.log(`  ✗ ${name}: ${e.message}`); }
  }

  console.log('\nPhase 65 — Bulk Export Selection\n');

  const uid = `p65_${Date.now()}`;
  const a = await add(`${uid} Alpha`);
  const b = await add(`${uid} Beta`);
  const c = await add(`${uid} Gamma`);

  // 1. ids param returns 200 with text/csv
  await test('GET /api/export?ids= returns 200 with text/csv', async () => {
    const r = await csvExport(`ids=${a.id}`);
    assert.strictEqual(r.status, 200);
    assert.ok(r.headers['content-type'].includes('text/csv'));
  });

  // 2. single id returns only that memory
  await test('single id returns only that memory row', async () => {
    const r = await csvExport(`ids=${a.id}`);
    assert.ok(r.body.includes(`${uid} Alpha`), 'Alpha should be present');
    assert.ok(!r.body.includes(`${uid} Beta`),  'Beta should be absent');
    assert.ok(!r.body.includes(`${uid} Gamma`), 'Gamma should be absent');
  });

  // 3. multiple ids return exactly those memories
  await test('two ids return exactly those two memories', async () => {
    const r = await csvExport(`ids=${a.id},${b.id}`);
    assert.ok(r.body.includes(`${uid} Alpha`), 'Alpha should be present');
    assert.ok(r.body.includes(`${uid} Beta`),  'Beta should be present');
    assert.ok(!r.body.includes(`${uid} Gamma`), 'Gamma should be absent');
  });

  // 4. all three ids return all three
  await test('all three ids return all three memories', async () => {
    const r = await csvExport(`ids=${a.id},${b.id},${c.id}`);
    assert.ok(r.body.includes(`${uid} Alpha`));
    assert.ok(r.body.includes(`${uid} Beta`));
    assert.ok(r.body.includes(`${uid} Gamma`));
  });

  // 5. filename is hive-selection.csv
  await test('ids export filename is hive-selection.csv', async () => {
    const r = await csvExport(`ids=${a.id}`);
    const cd = r.headers['content-disposition'] || '';
    assert.ok(cd.includes('hive-selection.csv'), `expected hive-selection.csv, got: ${cd}`);
  });

  // 6. unknown id is silently skipped (no error)
  await test('unknown id is silently skipped, rest still exported', async () => {
    const r = await csvExport(`ids=${a.id},00000000-0000-0000-0000-000000000000`);
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.includes(`${uid} Alpha`), 'Alpha should still be present');
  });

  // 7. all unknown ids returns header-only CSV (200, not error)
  await test('all unknown ids returns 200 with header-only CSV', async () => {
    const r = await csvExport('ids=00000000-0000-0000-0000-000000000000');
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.includes('id,title'), 'should still have CSV header');
    assert.ok(!r.body.includes(uid), 'no test data should appear');
  });

  // 8. ids export doesn't interfere with filter export (both still work)
  await test('filter export still works independently', async () => {
    const r = await csvExport('type=semantic');
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.includes(`${uid} Alpha`), 'filter export should still work');
  });

  // 9. dashboard HTML has exportSelectionCsv function
  await test('dashboard HTML has exportSelectionCsv function', async () => {
    const r = await req('GET', '/');
    assert.ok(r.body.includes('exportSelectionCsv'), 'expected exportSelectionCsv in HTML');
  });

  // 10. bulk bar has CSV button
  await test('bulk bar has ⬇ CSV button', async () => {
    const r = await req('GET', '/');
    assert.ok(r.body.includes('exportSelectionCsv'), 'expected exportSelectionCsv call in HTML');
    // The button text is in the bulk bar
    const bulkBarIdx = r.body.indexOf('bulk-bar');
    const csvBtnIdx  = r.body.indexOf('exportSelectionCsv');
    assert.ok(bulkBarIdx > 0 && csvBtnIdx > bulkBarIdx, 'CSV button should be inside/after bulk-bar');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
