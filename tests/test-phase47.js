'use strict';
const assert = require('assert');
const path   = require('path');
const http   = require('http');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p47-${Date.now()}.db`);

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

async function addMem(title, tags) {
  const r = await req('POST', '/api/memories', { title, content: title, memory_type: 'semantic', tags });
  return r.body;
}

async function run() {
  let passed = 0;
  const total = 10;
  async function test(name, fn) {
    try { await fn(); console.log(`  ✓ ${name}`); passed++; }
    catch (e) { console.log(`  ✗ ${name}: ${e.message}`); }
  }

  console.log('\nPhase 47 — Tag Cloud UI\n');

  // Seed test memories via API so they land in the server's DB
  const tag = `p47test_${Date.now()}`; // unique tag to avoid cross-test pollution
  const tagB = `p47b_${Date.now()}`;
  await addMem('P47 Node A', [tag, tagB]);
  await addMem('P47 Node B', [tag, tagB]);
  await addMem('P47 Solo',   [tag]);
  await addMem('P47 Other',  [tagB]);
  await addMem('P47 NoTag',  []);

  // 1. GET /api/memories?tag= returns only memories with that tag
  await test('GET /api/memories?tag returns only tagged memories', async () => {
    const r = await req('GET', `/api/memories?tag=${tag}`);
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.length >= 3, `expected >=3, got ${r.body.length}`);
    for (const m of r.body) assert.ok((m.tags||[]).includes(tag), `"${m.title}" missing tag`);
  });

  // 2. tag filter excludes non-matching memories
  await test('tag filter excludes memories without that tag', async () => {
    const r = await req('GET', `/api/memories?tag=${tag}`);
    for (const m of r.body) assert.ok(!(m.title === 'P47 NoTag'), 'untagged memory should be excluded');
  });

  // 3. tag filter with unknown tag returns empty array
  await test('unknown tag returns empty array', async () => {
    const r = await req('GET', `/api/memories?tag=completely_unknown_tag_xyz123`);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.length, 0);
  });

  // 4. GET /api/tags/stats returns top array with correct counts
  await test('GET /api/tags/stats includes seeded tag with correct count', async () => {
    const r = await req('GET', '/api/tags/stats?limit=200');
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.body.top));
    const found = r.body.top.find(t => t.tag === tag);
    assert.ok(found, `tag ${tag} not found in stats`);
    assert.ok(found.count >= 3, `expected count >=3, got ${found.count}`);
  });

  // 5. second tag has correct count
  await test('second seeded tag has correct count', async () => {
    const r = await req('GET', '/api/tags/stats?limit=200');
    const found = r.body.top.find(t => t.tag === tagB);
    assert.ok(found && found.count >= 3, `tagB count: ${found?.count}`);
  });

  // 6. memories without tags excluded from any tag filter
  await test('untagged memory not returned by any tag filter', async () => {
    const r = await req('GET', `/api/memories?tag=${tag}`);
    const noTagMem = r.body.find(m => m.title === 'P47 NoTag');
    assert.ok(!noTagMem, 'P47 NoTag should not appear in tag-filtered results');
  });

  // 7. limit param respected
  await test('tag filter respects limit param', async () => {
    const r = await req('GET', `/api/memories?tag=${tag}&limit=2`);
    assert.ok(r.body.length <= 2, `expected <=2, got ${r.body.length}`);
  });

  // 8. tag filter with special characters (hyphen) works
  await test('tag with hyphen works in filter', async () => {
    const hyphenTag = `p47-hyphen-${Date.now()}`;
    await addMem('P47 Hyphen mem', [hyphenTag]);
    const r = await req('GET', `/api/memories?tag=${encodeURIComponent(hyphenTag)}`);
    assert.ok(r.body.length >= 1);
    assert.ok(r.body[0].tags.includes(hyphenTag));
  });

  // 9. co-occurrence returns related tags
  await test('GET /api/tags/stats?co= returns co-occurring tags', async () => {
    const r = await req('GET', `/api/tags/stats?co=${encodeURIComponent(tag)}`);
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.body.co), 'missing co array');
    const coTags = r.body.co.map(t => t.tag);
    assert.ok(coTags.includes(tagB), `expected ${tagB} in co-tags, got: ${coTags}`);
  });

  // 10. tagB (co-occurring) also shows the original tag in its co-occurrence list
  await test('co-occurrence is symmetric', async () => {
    const r = await req('GET', `/api/tags/stats?co=${encodeURIComponent(tagB)}`);
    assert.ok(Array.isArray(r.body.co));
    const coTags = r.body.co.map(t => t.tag);
    assert.ok(coTags.includes(tag), `expected ${tag} in co-tags of ${tagB}`);
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
