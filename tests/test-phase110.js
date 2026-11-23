'use strict';
const assert = require('assert');
const http   = require('http');
const path   = require('path');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p110-${Date.now()}.db`);

function req(method, pathname, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = { hostname: '127.0.0.1', port: 7749, path: pathname, method,
                   headers: { 'X-Hive-Local': '1', ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) } };
    const r = http.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => resolve({ status: res.statusCode, body: raw, headers: res.headers }));
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

  console.log('\nPhase 110 — Markdown Export per Memory\n');

  // Seed a rich memory
  const seedRes = await new Promise((resolve, reject) => {
    const data = JSON.stringify({ title: 'Test Export', content: 'export content here', memory_type: 'core', tags: ['alpha','beta'], domain: 'engineering', confidence: 0.85, importance: 8 });
    const opts = { hostname: '127.0.0.1', port: 7749, path: '/api/memories', method: 'POST',
                   headers: { 'X-Hive-Local': '1', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } };
    const r = http.request(opts, res => { let raw=''; res.on('data',c=>raw+=c); res.on('end',()=>resolve(JSON.parse(raw))); });
    r.on('error', reject); r.write(data); r.end();
  });
  const id = seedRes.id;

  // 1. endpoint returns 200
  await test('GET /export/markdown returns 200', async () => {
    const { status } = await req('GET', `/api/memories/${id}/export/markdown`);
    assert.strictEqual(status, 200);
  });

  // 2. content-type is text/markdown
  await test('content-type is text/markdown', async () => {
    const { headers } = await req('GET', `/api/memories/${id}/export/markdown`);
    assert.ok(headers['content-type'] && headers['content-type'].includes('markdown'),
      `expected text/markdown, got ${headers['content-type']}`);
  });

  // 3. response starts with # (markdown heading)
  await test('response starts with markdown heading', async () => {
    const { body } = await req('GET', `/api/memories/${id}/export/markdown`);
    assert.ok(body.startsWith('# '), 'expected markdown heading at start');
  });

  // 4. response contains the memory title
  await test('response contains memory title', async () => {
    const { body } = await req('GET', `/api/memories/${id}/export/markdown`);
    assert.ok(body.includes('Test Export'), 'expected title in markdown');
  });

  // 5. response contains the memory content
  await test('response contains memory content', async () => {
    const { body } = await req('GET', `/api/memories/${id}/export/markdown`);
    assert.ok(body.includes('export content here'), 'expected content in markdown');
  });

  // 6. response includes tags
  await test('response includes tags', async () => {
    const { body } = await req('GET', `/api/memories/${id}/export/markdown`);
    assert.ok(body.includes('#alpha') && body.includes('#beta'), 'expected tags in markdown');
  });

  // 7. response includes confidence percentage
  await test('response includes confidence percentage', async () => {
    const { body } = await req('GET', `/api/memories/${id}/export/markdown`);
    assert.ok(body.includes('85%'), 'expected confidence % in markdown');
  });

  // 8. non-existent id returns 404
  await test('non-existent id returns 404', async () => {
    const { status, body } = await req('GET', '/api/memories/nonexistent-xyz/export/markdown');
    assert.strictEqual(status, 404);
  });

  const htmlRes = await new Promise((resolve, reject) => {
    const opts = { hostname: '127.0.0.1', port: 7749, path: '/', method: 'GET', headers: { 'X-Hive-Local': '1' } };
    const r = http.request(opts, res => { let raw=''; res.on('data',c=>raw+=c); res.on('end',()=>resolve(raw)); });
    r.on('error', reject); r.end();
  });

  // 9. HTML has copyAsMarkdown function
  await test('HTML has copyAsMarkdown function', async () => {
    assert.ok(htmlRes.includes('copyAsMarkdown'), 'expected copyAsMarkdown in HTML');
  });

  // 10. HTML references the markdown export endpoint
  await test('HTML references /export/markdown endpoint', async () => {
    assert.ok(htmlRes.includes('/export/markdown'), 'expected /export/markdown endpoint in HTML');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
