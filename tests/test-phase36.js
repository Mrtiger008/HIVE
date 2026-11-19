'use strict';
const assert = require('assert');
const path   = require('path');
const fs     = require('fs');
const os     = require('os');
const http   = require('http');

process.env.HIVE_DB = path.join(os.tmpdir(), `hive-test-p36-${Date.now()}.db`);

const memory   = require('../src/memory');
const links    = require('../src/links');
const obsidian = require('../src/obsidian');

function req(method, pathname) {
  return new Promise((resolve, reject) => {
    const r = http.request({ hostname: '127.0.0.1', port: 7749, path: pathname, method,
      headers: { 'X-Hive-Local': '1' } }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        let b = null; try { b = raw ? JSON.parse(raw) : null; } catch { b = raw; }
        resolve({ status: res.statusCode, body: b });
      });
    });
    r.on('error', reject); r.end();
  });
}

async function run() {
  let passed = 0;
  const total = 10;

  async function test(name, fn) {
    try { await fn(); console.log(`  ✓ ${name}`); passed++; }
    catch (e) { console.log(`  ✗ ${name}: ${e.message}`); }
  }

  console.log('\nPhase 36 — Obsidian Export\n');

  // 1. slugify produces clean filenames
  await test('slugify handles special characters', async () => {
    assert.strictEqual(obsidian.slugify('Hello, World!'), 'hello-world');
    assert.strictEqual(obsidian.slugify('React Hooks & State'), 'react-hooks-state');
    assert.strictEqual(obsidian.slugify('  spaces  '), 'spaces');
  });

  // 2. generate() returns array with filename and content
  await test('generate() returns filename and content fields', async () => {
    memory.add({ title: 'Test Export Mem', content: 'Body text here', memory_type: 'semantic' });
    const files = obsidian.generate();
    assert.ok(Array.isArray(files));
    assert.ok(files.length > 0);
    assert.ok(files[0].filename.endsWith('.md'));
    assert.ok(typeof files[0].content === 'string');
  });

  // 3. YAML frontmatter is present
  await test('generated file has YAML frontmatter', async () => {
    const m = memory.add({ title: 'Frontmatter Test', content: 'Content', memory_type: 'domain', trust_level: 'SOURCE_VERIFIED', confidence: 0.9 });
    const files = obsidian.generate();
    const f = files.find(x => x.id === m.id);
    assert.ok(f, 'file not found');
    assert.ok(f.content.startsWith('---\n'), 'missing frontmatter start');
    assert.ok(f.content.includes('trust_level: SOURCE_VERIFIED'));
    assert.ok(f.content.includes('confidence: 0.9'));
    assert.ok(f.content.includes('memory_type: domain'));
  });

  // 4. Tags appear in frontmatter and body
  await test('tags appear in frontmatter and as #hashtags', async () => {
    const m = memory.add({ title: 'Tagged Memory', content: 'Body', memory_type: 'semantic', tags: ['typescript', 'react'] });
    const files = obsidian.generate();
    const f = files.find(x => x.id === m.id);
    assert.ok(f.content.includes('"typescript"'));
    assert.ok(f.content.includes('#typescript'));
    assert.ok(f.content.includes('#react'));
  });

  // 5. Title is rendered as H1 heading
  await test('memory title appears as H1 heading', async () => {
    const m = memory.add({ title: 'Heading Check', content: 'Some content', memory_type: 'semantic' });
    const files = obsidian.generate();
    const f = files.find(x => x.id === m.id);
    assert.ok(f.content.includes('\n# Heading Check\n'));
  });

  // 6. Memory content is in the file body
  await test('memory content is included in file body', async () => {
    const m = memory.add({ title: 'Content Body', content: 'Unique content xyz789', memory_type: 'semantic' });
    const files = obsidian.generate();
    const f = files.find(x => x.id === m.id);
    assert.ok(f.content.includes('Unique content xyz789'));
  });

  // 7. Links generate [[wikilinks]]
  await test('memory links generate [[wikilinks]] in links section', async () => {
    const a = memory.add({ title: 'Link Source', content: 'C', memory_type: 'semantic' });
    const b = memory.add({ title: 'Link Target', content: 'C', memory_type: 'semantic' });
    links.add(a.id, 'related', b.id);
    const files = obsidian.generate();
    const fA = files.find(x => x.id === a.id);
    assert.ok(fA.content.includes('[[link-target]]'), `expected [[link-target]] in:\n${fA.content}`);
    assert.ok(fA.content.includes('## Links'));
  });

  // 8. Archived memories are excluded
  await test('archived memories are excluded from export', async () => {
    const m = memory.add({ title: 'Archived Mem', content: 'C', memory_type: 'semantic' });
    memory.update(m.id, { status: 'archived' });
    const files = obsidian.generate();
    assert.ok(!files.some(f => f.id === m.id), 'archived memory should not appear in export');
  });

  // 9. writeVault writes files to disk
  await test('writeVault writes .md files to output directory', async () => {
    const dir = path.join(os.tmpdir(), `hive-vault-test-${Date.now()}`);
    const n = obsidian.writeVault(dir);
    assert.ok(n > 0, 'expected at least one file written');
    const written = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
    assert.ok(written.length === n, `expected ${n} files, found ${written.length}`);
    fs.rmSync(dir, { recursive: true });
  });

  // 10. API GET /api/export/obsidian returns array
  await test('GET /api/export/obsidian returns array of files', async () => {
    const r = await req('GET', '/api/export/obsidian');
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.body), 'expected array');
    if (r.body.length > 0) {
      assert.ok(r.body[0].filename.endsWith('.md'));
      assert.ok(typeof r.body[0].content === 'string');
    }
  });

  console.log(`\n${passed}/${total} tests passed\n`);
  process.exit(passed === total ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
