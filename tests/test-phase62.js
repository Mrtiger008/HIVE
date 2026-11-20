'use strict';
const assert = require('assert');
const path   = require('path');
const http   = require('http');
const fs     = require('fs');
const os     = require('os');

process.env.HIVE_DB = path.join(os.tmpdir(), `hive-test-p62-${Date.now()}.db`);

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

function makeTmpDir(...files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-p62-'));
  for (const [name, content] of files) fs.writeFileSync(path.join(dir, name), content, 'utf8');
  return dir;
}

async function run() {
  let passed = 0;
  const total = 10;
  async function test(name, fn) {
    try { await fn(); console.log(`  ✓ ${name}`); passed++; }
    catch (e) { console.log(`  ✗ ${name}: ${e.message}`); }
  }

  console.log('\nPhase 62 — Multi-file Markdown Import\n');

  const uid = `p62_${Date.now()}`;

  // 1. POST /api/import/dir with auto=false returns proposals
  await test('preview returns proposals without storing', async () => {
    const dir = makeTmpDir([`${uid}_a.md`, `# Alpha\nContent alpha`]);
    const r = await req('POST', '/api/import/dir', { path: dir, auto: false });
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.body.proposals), 'expected proposals array');
    assert.ok(r.body.proposals.length >= 1, 'expected at least 1 proposal');
    // Not stored yet
    const list = (await req('GET', '/api/memories?limit=1000')).body;
    assert.ok(!list.some(m => m.title === 'Alpha'), 'should not be stored in preview mode');
  });

  // 2. POST /api/import/dir with auto=true stores memories
  await test('import with auto=true stores all files', async () => {
    const dir = makeTmpDir(
      [`${uid}_b1.md`, `# Beta One\nContent beta one`],
      [`${uid}_b2.md`, `# Beta Two\nContent beta two`],
    );
    const r = await req('POST', '/api/import/dir', { path: dir, auto: true });
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.body.stored), 'expected stored array');
    assert.strictEqual(r.body.stored.length, 2);
  });

  // 3. already-imported files are skipped on second run
  await test('second import of same directory skips already-imported files', async () => {
    const dir = makeTmpDir([`${uid}_c.md`, `# Gamma\nContent gamma`]);
    await req('POST', '/api/import/dir', { path: dir, auto: true });
    const r2 = await req('POST', '/api/import/dir', { path: dir, auto: true });
    assert.strictEqual(r2.status, 200);
    const skipped = r2.body.skipped || [];
    assert.ok(skipped.length >= 1, 'second run should report skip');
    assert.strictEqual((r2.body.stored || []).length, 0, 'nothing new should be stored');
  });

  // 4. frontmatter title is used when present
  await test('frontmatter title overrides filename title', async () => {
    const dir = makeTmpDir([`${uid}_d.md`, `---\ntitle: Frontmatter Title\n---\nSome content`]);
    const r = await req('POST', '/api/import/dir', { path: dir, auto: true });
    assert.ok(r.body.stored.some(m => m.title === 'Frontmatter Title'), 'frontmatter title should win');
  });

  // 5. frontmatter tags are parsed
  await test('frontmatter tags are imported', async () => {
    const dir = makeTmpDir([`${uid}_e.md`, `---\ntags: tagx, tagy\n---\nContent`]);
    const r = await req('POST', '/api/import/dir', { path: dir, auto: true });
    const m = r.body.stored[0];
    assert.ok(m.tags.includes('tagx'), 'tagx should be in tags');
    assert.ok(m.tags.includes('tagy'), 'tagy should be in tags');
  });

  // 6. missing path returns 400
  await test('missing path returns 400', async () => {
    const r = await req('POST', '/api/import/dir', { auto: true });
    assert.strictEqual(r.status, 400);
    assert.ok(r.body.error, 'expected error message');
  });

  // 7. non-existent directory returns 400 with error
  await test('non-existent directory returns 400', async () => {
    const r = await req('POST', '/api/import/dir', { path: '/no/such/dir/ever', auto: false });
    assert.strictEqual(r.status, 400);
    assert.ok(r.body.error, 'expected error message');
  });

  // 8. non-.md files are ignored
  await test('non-.md files in the directory are ignored', async () => {
    const dir = makeTmpDir(
      [`${uid}_f.txt`, 'plain text ignored'],
      [`${uid}_g.md`, `# Real MD\nContent`],
    );
    const r = await req('POST', '/api/import/dir', { path: dir, auto: false });
    assert.strictEqual(r.body.proposals.length, 1, 'only 1 md file should be proposed');
  });

  // 9. preview returns proposals array even on empty dir
  await test('empty directory returns empty proposals and skipped', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-p62-empty-'));
    const r = await req('POST', '/api/import/dir', { path: dir, auto: false });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.body.proposals, []);
  });

  // 10. dashboard HTML has importPreview and importAll functions
  await test('dashboard HTML has importPreview and importAll functions', async () => {
    const r = await new Promise((resolve, reject) => {
      const o = http.request({ hostname:'127.0.0.1', port:7749, path:'/', method:'GET' }, res => {
        let raw = ''; res.on('data', c => raw += c); res.on('end', () => resolve(raw));
      });
      o.on('error', reject); o.end();
    });
    assert.ok(r.includes('importPreview'), 'expected importPreview in HTML');
    assert.ok(r.includes('importAll'),     'expected importAll in HTML');
    assert.ok(r.includes('⬆ Import All'), 'expected Import All button text in HTML');
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
