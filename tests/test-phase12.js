'use strict';
// HIVE Phase 12 — Markdown import tests.
// Run: node tests/test-phase12.js

const assert = require('assert');
const path   = require('path');
const fs     = require('fs');
const os     = require('os');

const TEST_DB  = path.join(__dirname, '..', 'database', 'hive-p12-test.db');
const TMP_DIR  = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-p12-'));
process.env.HIVE_DB = TEST_DB;

fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);

const { parseMd, importFile, importDir } = require('../src/importer');
const memory = require('../src/memory');
const { getDb, closeDb } = require('../src/db');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✅  ${name}`); pass++; }
  catch (e) { console.error(`  ❌  ${name}\n      ${e.message}`); fail++; }
}

function write(name, content) {
  const p = path.join(TMP_DIR, name);
  fs.writeFileSync(p, content, 'utf8');
  return p;
}

console.log('\nHIVE — Phase 12 markdown import tests\n');

// ── I-1: parseMd extracts title from H1 ──────────────────────────────────────
test('I-1. parseMd — extracts title from # H1 heading', () => {
  const f = write('h1.md', '# My Great Note\n\nSome content here.');
  const r = parseMd(fs.readFileSync(f, 'utf8'), f);
  assert.strictEqual(r.title, 'My Great Note');
  assert(r.content.includes('Some content here'), 'body must exclude the H1 line');
});

// ── I-2: parseMd reads YAML frontmatter ──────────────────────────────────────
test('I-2. parseMd — reads YAML frontmatter fields', () => {
  const f = write('fm.md', '---\ntitle: Frontmatter Title\ntype: core\ntrust: USER_CONFIRMED\nimportance: 8\ntags: sqlite, notes\n---\n\nBody text.');
  const r = parseMd(fs.readFileSync(f, 'utf8'), f);
  assert.strictEqual(r.title, 'Frontmatter Title');
  assert.strictEqual(r.memory_type, 'core');
  assert.strictEqual(r.trust_level, 'USER_CONFIRMED');
  assert.strictEqual(r.importance, 8);
  assert.deepStrictEqual(r.tags, ['sqlite', 'notes']);
});

// ── I-3: parseMd falls back to filename as title ──────────────────────────────
test('I-3. parseMd — falls back to filename when no H1 or frontmatter title', () => {
  const f = write('my-important-note.md', 'Just some text without a heading.');
  const r = parseMd(fs.readFileSync(f, 'utf8'), f);
  assert.strictEqual(r.title, 'my important note');
});

// ── I-4: parseMd handles no frontmatter ──────────────────────────────────────
test('I-4. parseMd — defaults when no frontmatter', () => {
  const f = write('plain.md', '# Plain Note\n\nPlain content.');
  const r = parseMd(fs.readFileSync(f, 'utf8'), f);
  assert.strictEqual(r.memory_type, 'semantic');
  assert.strictEqual(r.trust_level, 'OBSERVED');
  assert.strictEqual(r.importance, 5);
  assert.deepStrictEqual(r.tags, []);
});

// ── I-5: importFile dry-run returns proposal without writing ──────────────────
test('I-5. importFile — dry-run returns proposal, does not write to DB', () => {
  const f = write('dryrun.md', '# Dry Run Note\n\nContent that should not be stored.');
  const before = getDb().prepare("SELECT COUNT(*) as n FROM memories").get().n;
  const r = importFile(f);
  assert(r.proposal, 'must return a proposal');
  assert.strictEqual(r.proposal.title, 'Dry Run Note');
  const after = getDb().prepare("SELECT COUNT(*) as n FROM memories").get().n;
  assert.strictEqual(after, before, 'dry-run must not write to DB');
});

// ── I-6: importFile --auto creates memory in DB ───────────────────────────────
test('I-6. importFile with auto=true — stores memory in DB', () => {
  const f = write('auto.md', '# Auto Import Note\n\nThis should be stored.');
  const r = importFile(f, { auto: true });
  assert(r.stored, 'must return stored memory');
  assert.strictEqual(r.stored.title, 'Auto Import Note');
  const m = memory.get(r.stored.id);
  assert(m, 'memory must exist in DB after import');
});

// ── I-7: importFile skips already-imported file ───────────────────────────────
test('I-7. importFile — skips file already imported (same source_ref)', () => {
  const f = write('dedup.md', '# Dedup Note\n\nImport once.');
  importFile(f, { auto: true }); // first import
  const r2 = importFile(f, { auto: true }); // second import
  assert.strictEqual(r2.skipped, true, 'second import must be skipped');
  assert.strictEqual(r2.reason, 'already imported');
  // Only one memory with this title should exist
  const count = getDb().prepare("SELECT COUNT(*) as n FROM memories WHERE title='Dedup Note'").get().n;
  assert.strictEqual(count, 1, `expected 1 memory, found ${count}`);
});

// ── I-8: importFile throws for missing file ───────────────────────────────────
test('I-8. importFile — throws for non-existent file', () => {
  assert.throws(
    () => importFile('/nonexistent/path/to/file.md'),
    /File not found/,
    'must throw File not found error'
  );
});

// ── I-9: importDir imports all .md files in a directory ──────────────────────
test('I-9. importDir — imports all .md files in a directory', () => {
  const sub = fs.mkdtempSync(path.join(TMP_DIR, 'dir-'));
  fs.writeFileSync(path.join(sub, 'a.md'), '# Note Alpha\n\nAlpha content.');
  fs.writeFileSync(path.join(sub, 'b.md'), '# Note Beta\n\nBeta content.');
  fs.writeFileSync(path.join(sub, 'c.md'), '# Note Gamma\n\nGamma content.');
  fs.writeFileSync(path.join(sub, 'readme.txt'), 'Not a markdown file — must be ignored.');
  const { stored, skipped } = importDir(sub, { auto: true });
  assert.strictEqual(stored.length, 3, `expected 3 stored, got ${stored.length}`);
  assert.strictEqual(skipped.length, 0);
  const titles = stored.map(m => m.title);
  assert(titles.includes('Note Alpha') && titles.includes('Note Beta') && titles.includes('Note Gamma'));
});

// ── I-10: importDir skips already-imported files ─────────────────────────────
test('I-10. importDir — skips files that were already imported', () => {
  const sub = fs.mkdtempSync(path.join(TMP_DIR, 'dir2-'));
  fs.writeFileSync(path.join(sub, 'x.md'), '# Note X\n\nContent X.');
  importDir(sub, { auto: true }); // first pass
  const { stored, skipped } = importDir(sub, { auto: true }); // second pass
  assert.strictEqual(stored.length, 0, 'nothing new should be stored on second import');
  assert.strictEqual(skipped.length, 1, 'the already-imported file must be in skipped');
  assert.strictEqual(skipped[0].reason, 'already imported');
});

// ── Cleanup ───────────────────────────────────────────────────────────────────
closeDb();
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
fs.rmSync(TMP_DIR, { recursive: true, force: true });
console.log(`\n${pass + fail} tests: ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
