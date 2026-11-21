'use strict';
const assert = require('assert');
const http   = require('http');
const path   = require('path');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p69-${Date.now()}.db`);

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

  console.log('\nPhase 69 — Memory Age Badge\n');

  const html = (await req('GET', '/')).body;

  // 1. dashboard has age() function
  await test('dashboard has age() function', async () => {
    assert.ok(html.includes('function age('), 'expected age() function in HTML');
  });

  // 2. age() handles hours
  await test('age() includes hour suffix logic', async () => {
    assert.ok(html.includes("+ 'h'"), 'expected hour suffix in age()');
  });

  // 3. age() handles days
  await test('age() includes day suffix logic', async () => {
    assert.ok(html.includes("+ 'd'"), 'expected day suffix in age()');
  });

  // 4. age() handles weeks
  await test('age() includes week suffix logic', async () => {
    assert.ok(html.includes("+ 'w'"), 'expected week suffix in age()');
  });

  // 5. age() handles months
  await test('age() includes month suffix logic', async () => {
    assert.ok(html.includes("+ 'm'"), 'expected month suffix in age()');
  });

  // 6. age() handles years
  await test('age() includes year suffix logic', async () => {
    assert.ok(html.includes("+ 'y'"), 'expected year suffix in age()');
  });

  // 7. card() uses ageStr variable
  await test('card() uses ageStr variable', async () => {
    assert.ok(html.includes('ageStr'), 'expected ageStr in HTML');
  });

  // 8. card HTML has age() call on created_at
  await test('card assigns ageStr = age(m.created_at)', async () => {
    assert.ok(html.includes('age(m.created_at)'), 'expected age(m.created_at) in HTML');
  });

  // 9. memory API returns created_at field
  await test('memory API returns created_at field', async () => {
    const { body: m } = await req('POST', '/api/memories', { title: 'Age test', content: 'content', memory_type: 'core' });
    assert.ok(m.created_at, 'expected created_at in memory response');
    assert.ok(typeof m.created_at === 'number', 'expected created_at to be a number');
  });

  // 10. age badge title includes "Created" text
  await test('age badge span has Created title attribute', async () => {
    assert.ok(html.includes('Created '), 'expected "Created " in age badge title');
    assert.ok(html.includes('toLocaleDateString'), 'expected toLocaleDateString in age badge title');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
