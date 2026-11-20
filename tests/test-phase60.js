'use strict';
const assert = require('assert');
const path   = require('path');
const http   = require('http');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p60-${Date.now()}.db`);

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

async function add(title, tags = [], type = 'semantic', importance = 5) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ title, content: 'content for ' + title, memory_type: type, tags, importance });
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

function csvGet(qs) {
  return req('GET', '/api/export?format=csv' + (qs ? '&' + qs : ''));
}

function parseRows(csv) {
  const lines = csv.trim().split('\n').map(l => l.trim()).filter(Boolean);
  return lines; // first line is header
}

async function run() {
  let passed = 0;
  const total = 10;
  async function test(name, fn) {
    try { await fn(); console.log(`  ✓ ${name}`); passed++; }
    catch (e) { console.log(`  ✗ ${name}: ${e.message}`); }
  }

  console.log('\nPhase 60 — Memory Export to CSV\n');

  const uid = `p60_${Date.now()}`;
  await add(`${uid} Core Alpha`,    ['alpha-tag'], 'core',     8);
  await add(`${uid} Semantic Beta`, ['beta-tag'],  'semantic', 5);
  await add(`${uid} Core Gamma`,    ['alpha-tag'], 'core',     7);

  // 1. unfiltered CSV returns 200 with text/csv content-type
  await test('GET /api/export?format=csv returns 200 with text/csv', async () => {
    const r = await csvGet('');
    assert.strictEqual(r.status, 200);
    assert.ok(r.headers['content-type'].includes('text/csv'), 'expected text/csv');
  });

  // 2. CSV has correct header row
  await test('CSV has correct header row', async () => {
    const r = await csvGet('');
    const header = parseRows(r.body)[0];
    assert.ok(header.includes('id'), 'missing id column');
    assert.ok(header.includes('title'), 'missing title column');
    assert.ok(header.includes('memory_type'), 'missing memory_type column');
    assert.ok(header.includes('content'), 'missing content column');
  });

  // 3. tag filter includes only matching memories
  await test('tag filter returns only memories with that tag', async () => {
    const r = await csvGet('tag=alpha-tag');
    const rows = parseRows(r.body).slice(1); // skip header
    const hit = rows.filter(l => l.includes(uid));
    assert.ok(hit.every(l => l.includes('Alpha') || l.includes('Gamma')), 'should only have Alpha and Gamma');
    assert.ok(!hit.some(l => l.includes('Beta')), 'Beta should not appear');
  });

  // 4. tag filter excludes non-matching memories
  await test('tag filter excludes memories without that tag', async () => {
    const r = await csvGet('tag=beta-tag');
    assert.ok(!r.body.includes(`${uid} Core Alpha`),    'Core Alpha should be excluded');
    assert.ok(!r.body.includes(`${uid} Core Gamma`),    'Core Gamma should be excluded');
    assert.ok(r.body.includes(`${uid} Semantic Beta`),  'Semantic Beta should be included');
  });

  // 5. type filter works
  await test('type filter returns only memories of that type', async () => {
    const r = await csvGet('type=core');
    const rows = parseRows(r.body).slice(1).filter(l => l.includes(uid));
    assert.ok(rows.length >= 2, 'expected at least 2 core memories');
    assert.ok(!rows.some(l => l.includes('Semantic Beta')), 'Semantic Beta should be excluded');
  });

  // 6. min_importance filter works
  await test('min_importance filter excludes low-importance memories', async () => {
    const r = await csvGet('min_importance=8');
    const rows = parseRows(r.body).slice(1).filter(l => l.includes(uid));
    // only Core Alpha has importance=8
    assert.ok(rows.some(l => l.includes('Core Alpha')),    'Core Alpha (i=8) should appear');
    assert.ok(!rows.some(l => l.includes('Core Gamma')),   'Core Gamma (i=7) should be excluded');
    assert.ok(!rows.some(l => l.includes('Semantic Beta')), 'Semantic Beta (i=5) should be excluded');
  });

  // 7. tag + type combined filter
  await test('tag + type combined filter applies both constraints', async () => {
    const r = await csvGet('tag=alpha-tag&type=core');
    assert.ok(r.body.includes(`${uid} Core Alpha`),     'Core Alpha matches both');
    assert.ok(!r.body.includes(`${uid} Semantic Beta`), 'Semantic Beta excluded (wrong tag + type)');
  });

  // 8. unknown tag filter returns header only (empty result set)
  await test('unknown tag returns header-only CSV (no data rows for this uid)', async () => {
    const r = await csvGet('tag=no-such-tag-' + Date.now());
    const rows = parseRows(r.body);
    assert.ok(rows.length >= 1, 'at least header row expected');
    // data rows from this test run should be absent
    assert.ok(!r.body.includes(uid), 'no test memories should appear for unknown tag');
  });

  // 9. filtered export filename is hive-filtered.csv
  await test('filtered export has hive-filtered.csv filename', async () => {
    const r = await csvGet('tag=alpha-tag');
    const cd = r.headers['content-disposition'] || '';
    assert.ok(cd.includes('hive-filtered.csv'), 'expected hive-filtered.csv in Content-Disposition');
  });

  // 10. dashboard HTML has exportFilteredCsv function and CSV button
  await test('dashboard HTML has exportFilteredCsv function and CSV button', async () => {
    const r = await req('GET', '/');
    assert.ok(r.body.includes('exportFilteredCsv'), 'expected exportFilteredCsv in HTML');
    assert.ok(r.body.includes('⬇ CSV'),             'expected CSV button in HTML');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
