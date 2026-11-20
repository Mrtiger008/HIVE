'use strict';
const assert = require('assert');
const http   = require('http');
const path   = require('path');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p64-${Date.now()}.db`);

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
      res.on('end', () => { let b; try { b = JSON.parse(raw); } catch { b = raw; } resolve({ status: res.statusCode, body: b }); });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

async function add(title, opts = {}) {
  return (await req('POST', '/api/memories', {
    title, content: opts.content || 'content for ' + title,
    memory_type: opts.memory_type || 'semantic',
    tags: opts.tags || [],
    importance: opts.importance || 5,
    trust_level: opts.trust_level || 'OBSERVED',
    confidence: opts.confidence != null ? opts.confidence : 0.5,
  })).body;
}

function getHtml() {
  return new Promise((resolve, reject) => {
    const o = http.request({ hostname:'127.0.0.1', port:7749, path:'/', method:'GET' }, res => {
      let raw = ''; res.on('data', c => raw += c); res.on('end', () => resolve(raw));
    });
    o.on('error', reject); o.end();
  });
}

async function run() {
  let passed = 0;
  const total = 10;
  async function test(name, fn) {
    try { await fn(); console.log(`  ✓ ${name}`); passed++; }
    catch (e) { console.log(`  ✗ ${name}: ${e.message}`); }
  }

  console.log('\nPhase 64 — Memory Templates Quick-Apply\n');

  const uid = `p64_${Date.now()}`;
  const html = await getHtml();

  // 1. GET /api/templates returns all template types
  await test('GET /api/templates returns all templates', async () => {
    const r = await req('GET', '/api/templates');
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.body), 'expected array');
    const types = r.body.map(t => t.memory_type);
    assert.ok(types.includes('core'),     'missing core');
    assert.ok(types.includes('skill'),    'missing skill');
    assert.ok(types.includes('semantic'), 'missing semantic');
  });

  // 2. applying 'core' template via PUT updates memory_type
  await test('applying core template sets memory_type to core', async () => {
    const m = await add(`${uid} A`, { memory_type: 'semantic' });
    const tpls = (await req('GET', '/api/templates')).body;
    const tpl = tpls.find(t => t.memory_type === 'core');
    const r = await req('PUT', `/api/memories/${m.id}`, {
      memory_type: tpl.memory_type, trust_level: tpl.trust_level,
      importance: tpl.importance, confidence: tpl.confidence,
      tags: [...new Set([...(m.tags||[]), ...(tpl.tags||[])])]
    });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.memory_type, 'core');
  });

  // 3. applying template sets trust_level from template
  await test('applying skill template sets trust_level to SOURCE_VERIFIED', async () => {
    const m = await add(`${uid} B`, { trust_level: 'OBSERVED' });
    const tpls = (await req('GET', '/api/templates')).body;
    const tpl = tpls.find(t => t.memory_type === 'skill');
    const r = await req('PUT', `/api/memories/${m.id}`, {
      memory_type: tpl.memory_type, trust_level: tpl.trust_level,
      importance: tpl.importance, confidence: tpl.confidence, tags: []
    });
    assert.strictEqual(r.body.trust_level, 'SOURCE_VERIFIED');
  });

  // 4. applying template sets importance from template
  await test('applying core template sets importance to 8', async () => {
    const m = await add(`${uid} C`, { importance: 3 });
    const tpls = (await req('GET', '/api/templates')).body;
    const tpl = tpls.find(t => t.memory_type === 'core');
    const r = await req('PUT', `/api/memories/${m.id}`, {
      memory_type: tpl.memory_type, trust_level: tpl.trust_level,
      importance: tpl.importance, confidence: tpl.confidence, tags: []
    });
    assert.strictEqual(r.body.importance, 8);
  });

  // 5. template tags are merged with existing tags (not replaced)
  await test('skill template tags merged with existing tags', async () => {
    const m = await add(`${uid} D`, { tags: ['existing-tag'] });
    const tpls = (await req('GET', '/api/templates')).body;
    const tpl = tpls.find(t => t.memory_type === 'skill'); // has ['howto']
    const merged = [...new Set([...(m.tags||[]), ...(tpl.tags||[])])];
    const r = await req('PUT', `/api/memories/${m.id}`, {
      memory_type: tpl.memory_type, trust_level: tpl.trust_level,
      importance: tpl.importance, confidence: tpl.confidence, tags: merged
    });
    assert.ok(r.body.tags.includes('existing-tag'), 'existing tag should be preserved');
    assert.ok(r.body.tags.includes('howto'),        'template tag should be added');
  });

  // 6. title and content are NOT changed by template apply
  await test('template apply preserves title and content', async () => {
    const m = await add(`${uid} E`, { content: 'important content' });
    const tpls = (await req('GET', '/api/templates')).body;
    const tpl = tpls.find(t => t.memory_type === 'core');
    await req('PUT', `/api/memories/${m.id}`, {
      memory_type: tpl.memory_type, trust_level: tpl.trust_level,
      importance: tpl.importance, confidence: tpl.confidence, tags: []
    });
    const updated = (await req('GET', `/api/memories/${m.id}`)).body;
    assert.strictEqual(updated.title, m.title,     'title should be unchanged');
    assert.strictEqual(updated.content, m.content, 'content should be unchanged');
  });

  // 7. dashboard HTML has applyTemplate function
  await test('dashboard HTML has applyTemplate function', async () => {
    assert.ok(html.includes('applyTemplate'), 'expected applyTemplate in HTML');
  });

  // 8. dashboard card has template select element
  await test('dashboard card has template select (⊞ tpl)', async () => {
    assert.ok(html.includes('⊞ tpl'), 'expected ⊞ tpl option in card');
  });

  // 9. template select has all 6 types as options
  await test('template select includes all 6 memory types', async () => {
    for (const t of ['core', 'skill', 'domain', 'project', 'episodic', 'semantic']) {
      assert.ok(html.includes(`value="${t}"`), `missing option for ${t}`);
    }
  });

  // 10. applying template via PUT returns 200 with updated memory
  await test('PUT with template fields returns 200 and updated memory', async () => {
    const m = await add(`${uid} F`);
    const r = await req('PUT', `/api/memories/${m.id}`, {
      memory_type: 'episodic', trust_level: 'OBSERVED', importance: 5, confidence: 0.7, tags: []
    });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.memory_type, 'episodic');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
