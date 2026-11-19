'use strict';
const assert = require('assert');
const path = require('path');
const os = require('os');

const DB = path.join(os.tmpdir(), `hive-test-p27-${Date.now()}.db`);
process.env.HIVE_DB = DB;

const { getDb, closeDb } = require('../src/db');
const memory   = require('../src/memory');
const versions = require('../src/versions');

let passed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n    ${e.message}`); }
}

getDb(); // init schema

console.log('\nPhase 27 — Memory Versioning\n');

// Create a memory to work with
const m = memory.add({
  title: 'Original title',
  content: 'Line one\nLine two\nLine three',
  memory_type: 'semantic',
  trust_level: 'OBSERVED',
  importance: 5,
});

// V-1: list empty before any snapshot
test('V-1  list() empty before any update', () => {
  assert.deepStrictEqual(versions.list(m.id), []);
});

// V-2: snapshot stores title and content
test('V-2  snapshot() stores title + content', () => {
  versions.snapshot(m.id, m.title, m.content);
  const list = versions.list(m.id);
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].title, 'Original title');
});

// V-3: get() retrieves a version by id
test('V-3  get() retrieves a version by id', () => {
  const v = versions.list(m.id)[0];
  const fetched = versions.get(v.id);
  assert.strictEqual(fetched.content, 'Line one\nLine two\nLine three');
});

// V-4: multiple snapshots accumulate
test('V-4  multiple snapshots accumulate', () => {
  versions.snapshot(m.id, 'Updated title', 'Line one\nLine two changed\nLine three');
  assert.strictEqual(versions.list(m.id).length, 2);
});

// V-5: list() returns newest first
test('V-5  list() ordered newest first', () => {
  const list = versions.list(m.id);
  assert.ok(list[0].snapshot_at >= list[1].snapshot_at);
});

// V-6: get() returns null for nonexistent id
test('V-6  get() returns undefined for missing id', () => {
  assert.strictEqual(versions.get(99999), undefined);
});

// V-7: diff() shows added lines
test('V-7  diff() marks added lines as "add"', () => {
  const ops = versions.diff('hello', 'hello\nworld');
  assert.ok(ops.some(o => o.type === 'add' && o.text === 'world'));
});

// V-8: diff() shows deleted lines
test('V-8  diff() marks removed lines as "del"', () => {
  const ops = versions.diff('hello\nworld', 'hello');
  assert.ok(ops.some(o => o.type === 'del' && o.text === 'world'));
});

// V-9: diff() shows unchanged lines as "eq"
test('V-9  diff() marks unchanged lines as "eq"', () => {
  const ops = versions.diff('a\nb\nc', 'a\nb\nd');
  assert.ok(ops.some(o => o.type === 'eq' && o.text === 'a'));
  assert.ok(ops.some(o => o.type === 'eq' && o.text === 'b'));
});

// V-10: diff() empty input
test('V-10 diff() handles empty strings', () => {
  const ops = versions.diff('', 'new line');
  assert.ok(ops.some(o => o.type === 'add' && o.text === 'new line'));
});

console.log(`\n${passed}/10 passed\n`);

closeDb();
