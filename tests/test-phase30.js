'use strict';
const assert = require('assert');
const path = require('path');
const os = require('os');

const DB = path.join(os.tmpdir(), `hive-test-p30-${Date.now()}.db`);
process.env.HIVE_DB = DB;

const { getDb, closeDb } = require('../src/db');
const memory = require('../src/memory');
const kstats = require('../src/stats');

let passed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n    ${e.message}`); }
}

getDb();

console.log('\nPhase 30 — Knowledge Stats Dashboard\n');

// Seed data
memory.add({ title: 'A', content: 'x', memory_type: 'core',     trust_level: 'USER_CONFIRMED',  importance: 9,  confidence: 0.9, domain: 'engineering' });
memory.add({ title: 'B', content: 'x', memory_type: 'skill',    trust_level: 'SOURCE_VERIFIED', importance: 7,  confidence: 0.8, domain: 'engineering' });
memory.add({ title: 'C', content: 'x', memory_type: 'semantic', trust_level: 'OBSERVED',        importance: 5,  confidence: 0.5, domain: 'personal' });
memory.add({ title: 'D', content: 'x', memory_type: 'episodic', trust_level: 'OBSERVED',        importance: 4,  confidence: 0.4, domain: null });

// S-1: full() returns expected shape
test('S-1  full() returns all required keys', () => {
  const s = kstats.full();
  for (const k of ['total','archived','entities','projects','byType','byTrust','byDomain','avgConf','avgImportance','growth'])
    assert.ok(k in s, `missing key: ${k}`);
});

// S-2: total count correct
test('S-2  total equals active memory count', () => {
  assert.strictEqual(kstats.full().total, 4);
});

// S-3: archived count starts at 0
test('S-3  archived count is 0 initially', () => {
  assert.strictEqual(kstats.full().archived, 0);
});

// S-4: archived count increments on archive
test('S-4  archived count increments after archiving', () => {
  const all = memory.list({ limit: 10 });
  memory.update(all[0].id, { status: 'archived' });
  const s = kstats.full();
  assert.strictEqual(s.archived, 1);
  assert.strictEqual(s.total, 3);
});

// S-5: byType is sorted desc and contains known types
test('S-5  byType sorted descending and contains seeded types', () => {
  const s = kstats.full();
  assert.ok(s.byType.length > 0);
  for (let i = 1; i < s.byType.length; i++)
    assert.ok(s.byType[i-1].count >= s.byType[i].count);
});

// S-6: byTrust contains seeded trust levels
test('S-6  byTrust contains OBSERVED', () => {
  assert.ok(kstats.full().byTrust.some(r => r.label === 'OBSERVED'));
});

// S-7: byDomain contains engineering
test('S-7  byDomain contains engineering domain', () => {
  assert.ok(kstats.full().byDomain.some(r => r.label === 'engineering'));
});

// S-8: avgConf is a number in [0,1]
test('S-8  avgConf is a number in [0,1]', () => {
  const c = kstats.full().avgConf;
  assert.ok(typeof c === 'number');
  assert.ok(c >= 0 && c <= 1);
});

// S-9: avgImportance is a number in [1,10]
test('S-9  avgImportance is a number in [1,10]', () => {
  const v = kstats.full().avgImportance;
  assert.ok(typeof v === 'number');
  assert.ok(v >= 1 && v <= 10);
});

// S-10: growth array has exactly 30 entries
test('S-10 growth array has exactly 30 entries', () => {
  const g = kstats.full().growth;
  assert.strictEqual(g.length, 30);
  for (const pt of g) {
    assert.ok('day' in pt);
    assert.ok('count' in pt);
    assert.ok(typeof pt.count === 'number');
  }
});

console.log(`\n${passed}/10 passed\n`);

closeDb();
