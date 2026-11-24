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

  console.log('\nPhase 123 — Clickable Domain Badge on Cards\n');

  // Seed memories: one with domain, one without
  const { body: m1 } = await req('POST', '/api/memories', { title: 'P123-WithDomain', content: 'Has a domain set', memory_type: 'core', domain: 'astronomy' });
  const { body: m2 } = await req('POST', '/api/memories', { title: 'P123-NoDomain',   content: 'No domain here', memory_type: 'core' });

  // 1. Memory API returns domain field
  await test('POST /api/memories returns domain field', async () => {
    assert.strictEqual(m1.domain, 'astronomy', 'expected domain=astronomy in created memory');
  });

  // 2. GET /api/memories/:id includes domain
  await test('GET /api/memories/:id includes domain', async () => {
    const { body } = await req('GET', `/api/memories/${m1.id}`);
    assert.strictEqual(body.domain, 'astronomy', 'expected domain in single-get response');
  });

  // 3. API domain filter returns only matching memories
  await test('GET /api/memories?domain=astronomy includes m1', async () => {
    const { body } = await req('GET', '/api/memories?domain=astronomy&limit=1000');
    const ids = body.map(m => m.id);
    assert.ok(ids.includes(m1.id), 'expected m1 in domain-filtered results');
  });

  // 4. API domain filter excludes non-matching memories
  await test('GET /api/memories?domain=astronomy excludes m2 (no domain)', async () => {
    const { body } = await req('GET', '/api/memories?domain=astronomy&limit=1000');
    const ids = body.map(m => m.id);
    assert.ok(!ids.includes(m2.id), 'expected m2 excluded when filtering by domain');
  });

  // 5. API domain filter with nonexistent domain returns empty set for seeded IDs
  await test('GET /api/memories?domain=xyzzy123 returns no seeded memories', async () => {
    const { body } = await req('GET', '/api/memories?domain=xyzzy123nonexistent&limit=1000');
    const ids = body.map(m => m.id);
    assert.ok(!ids.includes(m1.id) && !ids.includes(m2.id), 'expected no seeded memories for fake domain');
  });

  const html = (await req('GET', '/')).body;

  // 6. HTML has filterDomain function
  await test('HTML has filterDomain function', async () => {
    assert.ok(html.includes('filterDomain'), 'expected filterDomain function in HTML');
  });

  // 7. filterDomain delegates to applyStatsFilter
  await test('filterDomain calls applyStatsFilter', async () => {
    assert.ok(html.includes('filterDomain') && html.includes('applyStatsFilter'), 'expected filterDomain to use applyStatsFilter');
  });

  // 8. Card generation code includes filterDomain call with domain value
  await test('card() generates filterDomain onclick for domain badge', async () => {
    assert.ok(html.includes("filterDomain('"), 'expected filterDomain with dynamic domain in card HTML generator');
  });

  // 9. Domain badge uses 🌐 icon
  await test('domain badge uses globe icon in card HTML', async () => {
    assert.ok(html.includes('🌐'), 'expected globe emoji in domain badge');
  });

  // 10. Domain badge only shown when domain exists (conditional)
  await test('domain badge is conditional on m.domain', async () => {
    assert.ok(html.includes('m.domain?') || html.includes('m.domain ?'), 'expected m.domain conditional for domain badge');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
