'use strict';
const assert = require('assert');
const path = require('path');
const os = require('os');

const DB = path.join(os.tmpdir(), `hive-test-p28-${Date.now()}.db`);
process.env.HIVE_DB = DB;

const { getDb, closeDb } = require('../src/db');
const memory = require('../src/memory');
const tags   = require('../src/tags');

let passed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n    ${e.message}`); }
}

getDb();

console.log('\nPhase 28 — Tag Analytics\n');

// Seed data
memory.add({ title: 'A', content: 'x', memory_type: 'semantic', trust_level: 'OBSERVED', importance: 5, tags: ['javascript','async','node'] });
memory.add({ title: 'B', content: 'x', memory_type: 'semantic', trust_level: 'OBSERVED', importance: 5, tags: ['javascript','promises','async'] });
memory.add({ title: 'C', content: 'x', memory_type: 'semantic', trust_level: 'OBSERVED', importance: 5, tags: ['python','async'] });
memory.add({ title: 'D', content: 'x', memory_type: 'semantic', trust_level: 'OBSERVED', importance: 5, tags: ['javascript'] });

// T-1: topTags returns results
test('T-1  topTags() returns non-empty array', () => {
  assert.ok(tags.topTags().length > 0);
});

// T-2: most frequent tag is first
test('T-2  topTags() sorted by count descending', () => {
  const top = tags.topTags();
  assert.strictEqual(top[0].tag, 'javascript'); // 3 memories
  assert.strictEqual(top[0].count, 3);
});

// T-3: async appears in top tags
test('T-3  topTags() includes async with count 3', () => {
  const top = tags.topTags();
  const a = top.find(t => t.tag === 'async');
  assert.ok(a);
  assert.strictEqual(a.count, 3);
});

// T-4: limit parameter respected
test('T-4  topTags(2) returns only 2 entries', () => {
  assert.strictEqual(tags.topTags(2).length, 2);
});

// T-5: each entry has tag and count fields
test('T-5  topTags() entries have tag and count', () => {
  const top = tags.topTags();
  for (const e of top) {
    assert.ok(typeof e.tag === 'string');
    assert.ok(typeof e.count === 'number');
  }
});

// T-6: coOccurrence returns tags that appear with the target
test('T-6  coOccurrence("javascript") returns co-tags', () => {
  const co = tags.coOccurrence('javascript');
  assert.ok(co.length > 0);
  assert.ok(co.some(t => t.tag === 'async'));
});

// T-7: coOccurrence excludes the target tag itself
test('T-7  coOccurrence() does not include the target tag', () => {
  const co = tags.coOccurrence('javascript');
  assert.ok(!co.some(t => t.tag === 'javascript'));
});

// T-8: coOccurrence count is correct
test('T-8  coOccurrence("async") includes javascript with count 2', () => {
  const co = tags.coOccurrence('async');
  const js = co.find(t => t.tag === 'javascript');
  assert.ok(js);
  assert.strictEqual(js.count, 2);
});

// T-9: coOccurrence for unknown tag returns empty array
test('T-9  coOccurrence("nonexistent") returns []', () => {
  assert.deepStrictEqual(tags.coOccurrence('nonexistent'), []);
});

// T-10: archived memories are excluded
test('T-10 topTags() excludes archived memories', () => {
  const all = memory.list({ limit: 100 });
  const target = all[0];
  memory.update(target.id, { status: 'archived' });
  const before = tags.topTags().find(t => t.tag === 'javascript');
  assert.ok(before.count < 3); // one memory archived
});

console.log(`\n${passed}/10 passed\n`);

closeDb();
