'use strict';
const assert = require('assert');
const http   = require('http');

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

  console.log('\nPhase 126 — Domain Field in Add/Edit Modal\n');

  // Seed a memory with a unique domain
  const { body: m1 } = await req('POST', '/api/memories', { title: 'P126-WithDomain', content: 'has domain', memory_type: 'core', domain: 'p126-unique-domain' });

  // 1. POST with domain sets it on created memory
  await test('POST /api/memories with domain sets domain', async () => {
    assert.strictEqual(m1.domain, 'p126-unique-domain');
  });

  // 2. GET /api/memories/:id returns domain
  await test('GET /api/memories/:id returns domain field', async () => {
    const { body } = await req('GET', `/api/memories/${m1.id}`);
    assert.strictEqual(body.domain, 'p126-unique-domain');
  });

  // 3. PUT /api/memories/:id can update domain
  await test('PUT /api/memories/:id can update domain', async () => {
    const { body } = await req('PUT', `/api/memories/${m1.id}`, { domain: 'p126-updated-domain' });
    assert.strictEqual(body.domain, 'p126-updated-domain');
  });

  // 4. GET after PUT reflects updated domain
  await test('GET after PUT reflects updated domain', async () => {
    const { body } = await req('GET', `/api/memories/${m1.id}`);
    assert.strictEqual(body.domain, 'p126-updated-domain');
  });

  // 5. GET /api/domains returns array including newly seeded domain
  await test('GET /api/domains returns array with p126-updated-domain', async () => {
    const { body } = await req('GET', '/api/domains');
    assert.ok(Array.isArray(body), 'expected array from /api/domains');
    assert.ok(body.includes('p126-updated-domain'), `expected p126-updated-domain in domains list`);
  });

  // 6. POST with domain=undefined (omitted) results in null domain
  await test('POST without domain results in null/undefined domain', async () => {
    const { body } = await req('POST', '/api/memories', { title: 'P126-NoDomain', content: 'no domain', memory_type: 'core' });
    assert.ok(body.domain == null, `expected null/undefined domain, got ${body.domain}`);
  });

  const html = (await req('GET', '/')).body;

  // 7. HTML add modal has nm-do domain input
  await test('HTML add modal has nm-do domain input', async () => {
    assert.ok(html.includes('id="nm-do"') || html.includes("id='nm-do'"), 'expected nm-do input in HTML');
  });

  // 8. HTML has nm-domains-dl datalist for autocomplete
  await test('HTML has nm-domains-dl datalist', async () => {
    assert.ok(html.includes('nm-domains-dl'), 'expected nm-domains-dl datalist in HTML');
  });

  // 9. HTML has loadDomainsDl function
  await test('HTML has loadDomainsDl function', async () => {
    assert.ok(html.includes('loadDomainsDl'), 'expected loadDomainsDl function in HTML');
  });

  // 10. _buildPayload includes domain from nm-do
  await test('_buildPayload includes domain field', async () => {
    assert.ok(html.includes("'nm-do'") && html.includes('domain'), 'expected nm-do wired into _buildPayload');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
