'use strict';
// HIVE Phase 17 — Export formats tests.
// Run: node tests/test-phase17.js

const assert = require('assert');
const path   = require('path');
const fs     = require('fs');
const http   = require('http');

const TEST_DB = path.join(__dirname, '..', 'database', 'hive-p17-test.db');
process.env.HIVE_DB = TEST_DB;

fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);

const memory = require('../src/memory');
const { exportJson, exportCsv } = require('../src/export');
const { createServer } = require('../src/server');
const { closeDb } = require('../src/db');

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
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on('error', reject);
  });
}

console.log('\nHIVE — Phase 17 export formats tests\n');

const srv = createServer();
srv.listen(0);
const port = srv.address().port;

// Seed memories
memory.add({ title: 'Alpha memory', content: 'First export test.', memory_type: 'core', importance: 8 });
memory.add({ title: 'Beta memory',  content: 'Second export, with "quotes" and\nnewlines.', memory_type: 'skill', importance: 6 });

(async () => {

  // X-1: exportJson() returns valid JSON
  await test('X-1. exportJson() — returns valid JSON string', () => {
    const out = exportJson();
    assert.doesNotThrow(() => JSON.parse(out), 'must be valid JSON');
  });

  // X-2: exportJson() contains all seeded memories
  await test('X-2. exportJson() — contains seeded memories', () => {
    const rows = JSON.parse(exportJson());
    assert(Array.isArray(rows), 'must be array');
    assert(rows.some(m => m.title === 'Alpha memory'), 'must include Alpha memory');
    assert(rows.some(m => m.title === 'Beta memory'),  'must include Beta memory');
  });

  // X-3: exportJson() tags are arrays not strings
  await test('X-3. exportJson() — tags are arrays', () => {
    const rows = JSON.parse(exportJson());
    assert(rows.every(m => Array.isArray(m.tags)), 'tags must be arrays');
  });

  // X-4: exportCsv() first line is a header row
  await test('X-4. exportCsv() — first line is CSV header', () => {
    const out = exportCsv();
    const header = out.split('\n')[0];
    assert(header.includes('id'), 'header must contain id');
    assert(header.includes('title'), 'header must contain title');
    assert(header.includes('content'), 'header must contain content');
  });

  // X-5: exportCsv() contains seeded memory titles
  await test('X-5. exportCsv() — contains seeded memory data', () => {
    const out = exportCsv();
    assert(out.includes('Alpha memory'), 'must include Alpha memory');
    assert(out.includes('Beta memory'),  'must include Beta memory');
  });

  // X-6: exportCsv() properly escapes double quotes in content
  await test('X-6. exportCsv() — double-quotes are escaped', () => {
    const out = exportCsv();
    // The content "with ""quotes"" and..." should appear escaped
    assert(out.includes('""quotes""'), 'double-quotes must be doubled in CSV');
  });

  // X-7: GET /api/export returns JSON by default
  await test('X-7. GET /api/export — default format is JSON', async () => {
    const r = await get(port, '/api/export');
    assert.strictEqual(r.status, 200);
    assert(r.headers['content-type'].includes('application/json'), 'content-type must be JSON');
    assert.doesNotThrow(() => JSON.parse(r.body), 'body must be valid JSON');
  });

  // X-8: GET /api/export?format=csv returns CSV
  await test('X-8. GET /api/export?format=csv — returns CSV', async () => {
    const r = await get(port, '/api/export?format=csv');
    assert.strictEqual(r.status, 200);
    assert(r.headers['content-type'].includes('text/csv'), 'content-type must be CSV');
    assert(r.body.startsWith('id,'), 'body must start with CSV header');
  });

  // X-9: export endpoint sets Content-Disposition attachment header
  await test('X-9. GET /api/export — sets Content-Disposition attachment', async () => {
    const r = await get(port, '/api/export?format=json');
    assert(r.headers['content-disposition'], 'must have Content-Disposition');
    assert(r.headers['content-disposition'].includes('attachment'), 'must be attachment');
    assert(r.headers['content-disposition'].includes('.json'), 'filename must have .json extension');
  });

  // X-10: dashboard HTML has export download links
  await test('X-10. GET / — HTML has JSON and CSV export links', async () => {
    const r = await get(port, '/');
    assert(r.body.includes('/api/export?format=json'), 'must include JSON export link');
    assert(r.body.includes('/api/export?format=csv'),  'must include CSV export link');
    assert(r.body.includes('hive-export.json'), 'must have JSON download filename');
    assert(r.body.includes('hive-export.csv'),  'must have CSV download filename');
  });

  // ── Cleanup ───────────────────────────────────────────────────────────────
  srv.close();
  closeDb();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  console.log(`\n${pass + fail} tests: ${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);

})();
