'use strict';
const assert = require('assert');
const path = require('path');
const os = require('os');

const DB = path.join(os.tmpdir(), `hive-test-p31-${Date.now()}.db`);
process.env.HIVE_DB = DB;

const { getDb, closeDb } = require('../src/db');
const memory = require('../src/memory');
const links  = require('../src/links');

let passed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n    ${e.message}`); }
}

getDb();

console.log('\nPhase 31 — Memory Linking\n');

const a = memory.add({ title: 'Memory A', content: 'content a', memory_type: 'semantic', trust_level: 'OBSERVED', importance: 5 });
const b = memory.add({ title: 'Memory B', content: 'content b', memory_type: 'semantic', trust_level: 'OBSERVED', importance: 5 });
const c = memory.add({ title: 'Memory C', content: 'content c', memory_type: 'semantic', trust_level: 'OBSERVED', importance: 5 });

// L-1: add() creates a link and returns it
test('L-1  add() creates link with correct fields', () => {
  const l = links.add(a.id, 'related', b.id);
  assert.ok(l.id);
  assert.strictEqual(l.from_id, a.id);
  assert.strictEqual(l.to_id, b.id);
  assert.strictEqual(l.rel_type, 'related');
});

// L-2: list() returns link for the from-side memory
test('L-2  list() shows link for from-side memory', () => {
  const ls = links.list(a.id);
  assert.ok(ls.some(l => l.to_id === b.id));
});

// L-3: list() returns link for the to-side memory too
test('L-3  list() shows link for to-side memory', () => {
  const ls = links.list(b.id);
  assert.ok(ls.some(l => l.from_id === a.id));
});

// L-4: link with notes
test('L-4  add() stores notes', () => {
  const l = links.add(a.id, 'supports', c.id, 'very relevant');
  assert.strictEqual(l.notes, 'very relevant');
});

// L-5: all valid rel_types accepted
test('L-5  all VALID_TYPES are accepted', () => {
  const extra = memory.add({ title: 'D', content: 'x', memory_type: 'semantic', trust_level: 'OBSERVED', importance: 5 });
  for (const type of links.VALID_TYPES) {
    assert.doesNotThrow(() => links.add(b.id, type, extra.id));
    // clean up for next iteration
    links.list(b.id).filter(l => l.to_id === extra.id || l.from_id === extra.id)
      .forEach(l => links.remove(l.id));
  }
});

// L-6: invalid rel_type throws
test('L-6  invalid rel_type throws', () => {
  assert.throws(() => links.add(a.id, 'invented_type', b.id), /rel_type must be/);
});

// L-7: missing memory throws
test('L-7  add() throws for nonexistent memory', () => {
  assert.throws(() => links.add('nonexistent-id', 'related', b.id), /not found/i);
});

// L-8: remove() deletes the link
test('L-8  remove() deletes link and returns 1', () => {
  const l = links.add(b.id, 'see-also', c.id);
  assert.strictEqual(links.remove(l.id), 1);
  assert.ok(!links.list(b.id).some(x => x.id === l.id));
});

// L-9: remove() nonexistent returns 0
test('L-9  remove() nonexistent link returns 0', () => {
  assert.strictEqual(links.remove('00000000-0000-0000-0000-000000000000'), 0);
});

// L-10: list() includes titles of linked memories
test('L-10 list() includes from_title and to_title', () => {
  const ls = links.list(a.id);
  assert.ok(ls.length > 0);
  for (const l of ls) {
    assert.ok('from_title' in l, 'missing from_title');
    assert.ok('to_title' in l, 'missing to_title');
  }
});

console.log(`\n${passed}/10 passed\n`);

closeDb();
