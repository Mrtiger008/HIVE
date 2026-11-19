'use strict';
const assert = require('assert');
const path = require('path');
const os = require('os');

const DB = path.join(os.tmpdir(), `hive-test-p32-${Date.now()}.db`);
process.env.HIVE_DB = DB;

const { getDb, closeDb } = require('../src/db');
const bookmarks = require('../src/bookmarks');

let passed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n    ${e.message}`); }
}

getDb();

console.log('\nPhase 32 — Search Bookmarks\n');

// B-1: list() empty initially
test('B-1  list() returns empty array initially', () => {
  assert.deepStrictEqual(bookmarks.list(), []);
});

// B-2: add() creates bookmark
test('B-2  add() creates and returns bookmark', () => {
  const b = bookmarks.add('async patterns', 'async await promise', 'keyword');
  assert.ok(b.id);
  assert.strictEqual(b.name, 'async patterns');
  assert.strictEqual(b.query, 'async await promise');
  assert.strictEqual(b.mode, 'keyword');
});

// B-3: list() returns the saved bookmark
test('B-3  list() returns saved bookmark', () => {
  const all = bookmarks.list();
  assert.ok(all.some(b => b.name === 'async patterns'));
});

// B-4: list() sorted by name
test('B-4  list() sorted alphabetically by name', () => {
  bookmarks.add('zzz last', 'zzz', 'keyword');
  bookmarks.add('aaa first', 'aaa', 'keyword');
  const names = bookmarks.list().map(b => b.name);
  assert.ok(names.indexOf('aaa first') < names.indexOf('zzz last'));
});

// B-5: get() retrieves by name
test('B-5  get() returns bookmark by name', () => {
  const b = bookmarks.get('async patterns');
  assert.ok(b);
  assert.strictEqual(b.query, 'async await promise');
});

// B-6: get() returns null for unknown name
test('B-6  get() returns null for unknown name', () => {
  assert.strictEqual(bookmarks.get('nonexistent'), null);
});

// B-7: duplicate name throws
test('B-7  add() throws on duplicate name', () => {
  assert.throws(() => bookmarks.add('async patterns', 'different query'), /name already exists|UNIQUE/i);
});

// B-8: invalid mode throws
test('B-8  add() throws on invalid mode', () => {
  assert.throws(() => bookmarks.add('bad mode bm', 'query', 'invalid_mode'), /mode must be/);
});

// B-9: remove() deletes by id
test('B-9  remove() deletes bookmark', () => {
  const b = bookmarks.add('temp bm', 'temp query');
  assert.strictEqual(bookmarks.remove(b.id), 1);
  assert.strictEqual(bookmarks.get('temp bm'), null);
});

// B-10: remove() nonexistent returns 0
test('B-10 remove() nonexistent id returns 0', () => {
  assert.strictEqual(bookmarks.remove(99999), 0);
});

console.log(`\n${passed}/10 passed\n`);

closeDb();
