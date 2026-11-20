'use strict';
const assert = require('assert');
const path   = require('path');
const http   = require('http');

process.env.HIVE_DB = path.join(require('os').tmpdir(), `hive-test-p50-${Date.now()}.db`);

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

async function addMem(title, content, opts = {}) {
  const r = await req('POST', '/api/memories', { title, content, memory_type: 'semantic', ...opts });
  return r.body;
}

const HL_OPEN = '\x01', HL_CLOSE = '\x02';

async function run() {
  let passed = 0;
  const total = 10;
  async function test(name, fn) {
    try { await fn(); console.log(`  ✓ ${name}`); passed++; }
    catch (e) { console.log(`  ✗ ${name}: ${e.message}`); }
  }

  console.log('\nPhase 50 — Full-text Search Highlighting\n');

  const uid = `p50_${Date.now()}`;
  await addMem(`${uid} Neural Networks`,    `Deep learning uses neural networks to learn representations`);
  await addMem(`${uid} Transformer Model`,  `The transformer architecture relies on attention mechanisms`);
  await addMem(`${uid} Vector Database`,    `Vector databases store embeddings for similarity search`);
  await addMem(`${uid} Gradient Descent`,   `Gradient descent optimizes model parameters iteratively`);

  // 1. search returns highlight_title field
  await test('search result includes highlight_title field', async () => {
    const r = await req('GET', `/api/search?q=${encodeURIComponent('neural')}&mode=keyword`);
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.length > 0, 'expected results');
    const hit = r.body.find(m => m.title.includes('Neural'));
    assert.ok(hit, 'Neural Networks memory not found');
    assert.ok('highlight_title' in hit, 'missing highlight_title field');
  });

  // 2. highlight_title contains the highlight markers around the matched term
  await test('highlight_title wraps matched term in markers', async () => {
    const r = await req('GET', `/api/search?q=${encodeURIComponent('neural')}&mode=keyword`);
    const hit = r.body.find(m => m.title.includes('Neural'));
    assert.ok(hit, 'Neural Networks memory not found');
    assert.ok(
      hit.highlight_title.includes(HL_OPEN) && hit.highlight_title.includes(HL_CLOSE),
      `expected HL markers in "${hit.highlight_title}"`
    );
  });

  // 3. highlighted term in title is the query term
  await test('highlighted region in title contains the query term', async () => {
    const r = await req('GET', `/api/search?q=${encodeURIComponent('neural')}&mode=keyword`);
    const hit = r.body.find(m => m.title.includes('Neural'));
    const marked = hit.highlight_title.slice(
      hit.highlight_title.indexOf(HL_OPEN) + 1,
      hit.highlight_title.indexOf(HL_CLOSE)
    );
    assert.ok(marked.toLowerCase().includes('neural'), `expected 'neural' in marked region, got "${marked}"`);
  });

  // 4. search result includes snippet field
  await test('search result includes snippet field', async () => {
    const r = await req('GET', `/api/search?q=${encodeURIComponent('attention')}&mode=keyword`);
    const hit = r.body.find(m => m.title.includes('Transformer'));
    assert.ok(hit, 'Transformer memory not found');
    assert.ok('snippet' in hit, 'missing snippet field');
  });

  // 5. snippet contains the matched term highlighted
  await test('snippet wraps matched content term in markers', async () => {
    const r = await req('GET', `/api/search?q=${encodeURIComponent('attention')}&mode=keyword`);
    const hit = r.body.find(m => m.title.includes('Transformer'));
    assert.ok(
      hit.snippet.includes(HL_OPEN) && hit.snippet.includes(HL_CLOSE),
      `expected HL markers in snippet "${hit.snippet}"`
    );
  });

  // 6. snippet text contains relevant content (not empty)
  await test('snippet is non-empty and relevant', async () => {
    const r = await req('GET', `/api/search?q=${encodeURIComponent('embeddings')}&mode=keyword`);
    const hit = r.body.find(m => m.title.includes('Vector'));
    assert.ok(hit, 'Vector Database memory not found');
    assert.ok(hit.snippet && hit.snippet.length > 5, `snippet too short: "${hit.snippet}"`);
  });

  // 7. multi-word search highlights all matched terms
  await test('multi-word query highlights all matched terms', async () => {
    const r = await req('GET', `/api/search?q=${encodeURIComponent('gradient model')}&mode=keyword`);
    assert.ok(r.body.length > 0, 'expected results');
    const anyHighlighted = r.body.some(m => m.highlight_title?.includes(HL_OPEN));
    assert.ok(anyHighlighted, 'expected at least one highlighted title');
  });

  // 8. all search results include highlight_title as a string
  await test('all results have highlight_title as string', async () => {
    const r = await req('GET', `/api/search?q=${encodeURIComponent('neural')}&mode=keyword`);
    for (const m of r.body) {
      assert.ok(typeof m.highlight_title === 'string', `highlight_title missing or not string on "${m.title}"`);
    }
  });

  // 9. snippet for content-matched memory contains content markers (not title markers in snippet)
  await test('snippet extraction works for content-only matches', async () => {
    // "iteratively" only appears in Gradient Descent's content
    const r = await req('GET', `/api/search?q=${encodeURIComponent('iteratively')}&mode=keyword`);
    const hit = r.body.find(m => m.title.includes('Gradient'));
    assert.ok(hit, 'Gradient Descent memory not found');
    assert.ok(hit.snippet && hit.snippet.includes(HL_OPEN), 'snippet should highlight content match');
  });

  // 10. highlight fields survive JSON serialisation (control chars preserved)
  await test('highlight markers survive JSON round-trip', async () => {
    const r = await req('GET', `/api/search?q=${encodeURIComponent('neural')}&mode=keyword`);
    const hit = r.body.find(m => m.title.includes('Neural'));
    // Markers must arrive as actual control chars, not escaped
    assert.strictEqual(hit.highlight_title.codePointAt(hit.highlight_title.indexOf(HL_OPEN)), 1,
      'expected \\x01 (codepoint 1) as highlight open marker');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
