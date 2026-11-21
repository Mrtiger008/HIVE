'use strict';
const assert = require('assert');
const http   = require('http');
const path   = require('path');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p93-${Date.now()}.db`);

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

  console.log('\nPhase 93 — Tag Descriptions\n');

  // 1. GET /api/tags/descriptions returns empty object initially
  await test('GET descriptions returns empty object initially', async () => {
    const { status, body } = await req('GET', '/api/tags/descriptions');
    assert.strictEqual(status, 200);
    assert.ok(typeof body === 'object' && !Array.isArray(body));
    assert.strictEqual(Object.keys(body).length, 0);
  });

  // 2. PUT sets a description
  await test('PUT sets description for a tag', async () => {
    const { status, body } = await req('PUT', '/api/tags/descriptions', { tag: 'javascript', description: 'JS snippets and patterns' });
    assert.strictEqual(status, 200);
    assert.ok(body.ok);
    assert.strictEqual(body.tag, 'javascript');
  });

  // 3. GET reflects the new description
  await test('GET reflects stored description', async () => {
    const { body } = await req('GET', '/api/tags/descriptions');
    assert.strictEqual(body['javascript'], 'JS snippets and patterns');
  });

  // 4. PUT updates an existing description
  await test('PUT updates existing description', async () => {
    await req('PUT', '/api/tags/descriptions', { tag: 'javascript', description: 'Updated JS notes' });
    const { body } = await req('GET', '/api/tags/descriptions');
    assert.strictEqual(body['javascript'], 'Updated JS notes');
  });

  // 5. PUT with blank description deletes it
  await test('PUT with blank description removes it', async () => {
    await req('PUT', '/api/tags/descriptions', { tag: 'javascript', description: '' });
    const { body } = await req('GET', '/api/tags/descriptions');
    assert.strictEqual(body['javascript'], undefined);
  });

  // 6. Multiple tags can have descriptions
  await test('multiple tags can have descriptions', async () => {
    await req('PUT', '/api/tags/descriptions', { tag: 'python', description: 'Python notes' });
    await req('PUT', '/api/tags/descriptions', { tag: 'rust',   description: 'Rust learnings' });
    const { body } = await req('GET', '/api/tags/descriptions');
    assert.strictEqual(body['python'], 'Python notes');
    assert.strictEqual(body['rust'],   'Rust learnings');
  });

  // 7. PUT without tag returns 400
  await test('PUT without tag returns 400', async () => {
    const { status } = await req('PUT', '/api/tags/descriptions', { description: 'no tag' });
    assert.strictEqual(status, 400);
  });

  const html = (await req('GET', '/')).body;

  // 8. HTML has setTagDesc function
  await test('HTML has setTagDesc function', async () => {
    assert.ok(html.includes('function setTagDesc('), 'expected setTagDesc in HTML');
  });

  // 9. HTML fetches /api/tags/descriptions in loadTagCloud
  await test('loadTagCloud fetches /api/tags/descriptions', async () => {
    assert.ok(html.includes('/api/tags/descriptions'), 'expected /api/tags/descriptions in loadTagCloud');
  });

  // 10. HTML has ✎ edit button for descriptions
  await test('HTML has edit description button (pencil icon)', async () => {
    assert.ok(html.includes('setTagDesc(') && html.includes('✎'), 'expected pencil edit button');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
