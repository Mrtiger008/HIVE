'use strict';
// HIVE Phase 3 — Knowledge graph tests.
// Run: node tests/test-graph.js

const assert = require('assert');
const path   = require('path');
const fs     = require('fs');

const TEST_DB = path.join(__dirname, '..', 'database', 'hive-graph-test.db');
process.env.HIVE_DB = TEST_DB;

fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);

const entities = require('../src/entities');
const graph    = require('../src/graph');
const memory   = require('../src/memory');

let pass = 0, fail = 0;

function test(name, fn) {
  try { fn(); console.log(`  ✅  ${name}`); pass++; }
  catch (e) { console.error(`  ❌  ${name}\n      ${e.message}`); fail++; }
}

console.log('\nHIVE — Phase 3 knowledge graph tests\n');

// ── G-1: Create entity and retrieve by id ────────────────────────────────────
test('G-1. Create entity — retrieved by id with correct fields', () => {
  const e = entities.create({ name: 'SQLite', entity_type: 'tool', description: 'Embedded SQL database engine' });
  assert(e.id, 'must have id');
  assert.strictEqual(e.name, 'SQLite');
  assert.strictEqual(e.entity_type, 'tool');
  assert.strictEqual(e.description, 'Embedded SQL database engine');
  assert(Array.isArray(e.aliases), 'aliases must be array');
  assert.strictEqual(e.aliases.length, 0);

  const fetched = entities.get(e.id);
  assert.strictEqual(fetched.name, e.name);
});

// ── G-2: Entity type validation ───────────────────────────────────────────────
test('G-2. Entity type validation — rejects unknown type', () => {
  assert.throws(
    () => entities.create({ name: 'X', entity_type: 'spaceship' }),
    /entity_type must be one of/
  );
});

// ── G-3: findByName — name and alias match ───────────────────────────────────
test('G-3. findByName — matches on name and aliases (case-insensitive)', () => {
  const e = entities.create({
    name: 'Node.js',
    entity_type: 'tool',
    aliases: ['nodejs', 'node'],
  });

  const byName = entities.findByName('node.js');
  assert(byName.some(x => x.id === e.id), 'must find by exact name (case-insensitive)');

  const byAlias = entities.findByName('nodejs');
  assert(byAlias.some(x => x.id === e.id), 'must find by alias');

  const byPartial = entities.findByName('nod');
  assert(byPartial.some(x => x.id === e.id), 'must find by partial match');
});

// ── G-4: Link two entities and retrieve relationship ─────────────────────────
test('G-4. Link entities — relationship created and retrievable', () => {
  const tool1 = entities.create({ name: 'better-sqlite3', entity_type: 'tool' });
  const tool2 = entities.get(entities.findByName('SQLite')[0].id);

  const rel = graph.link({
    from_id: tool1.id,
    rel_type: 'DEPENDS_ON',
    to_id: tool2.id,
    confidence: 0.95,
    notes: 'better-sqlite3 is a Node.js binding for SQLite',
  });

  assert(rel.id, 'relationship must have id');
  assert.strictEqual(rel.rel_type, 'DEPENDS_ON');
  assert.strictEqual(rel.from_id, tool1.id);
  assert.strictEqual(rel.to_id, tool2.id);
  assert.strictEqual(rel.confidence, 0.95);

  const fetched = graph.getRelationship(rel.id);
  assert.strictEqual(fetched.id, rel.id);
});

// ── G-5: neighbors() — outgoing direction ────────────────────────────────────
test('G-5. neighbors() outgoing — returns downstream entities', () => {
  const bsql3 = entities.findByName('better-sqlite3')[0];
  const sqlite = entities.findByName('SQLite')[0];

  const out = graph.neighbors(bsql3.id, { direction: 'out' });
  assert(out.length > 0, 'must find outgoing neighbors');
  assert(out.some(n => n.id === sqlite.id), 'SQLite must be an outgoing neighbor');
  assert(out.every(n => n.direction === 'out'), 'direction must be "out"');
});

// ── G-6: neighbors() — incoming direction ────────────────────────────────────
test('G-6. neighbors() incoming — returns upstream entities', () => {
  const sqlite = entities.findByName('SQLite')[0];
  const bsql3  = entities.findByName('better-sqlite3')[0];

  const inc = graph.neighbors(sqlite.id, { direction: 'in' });
  assert(inc.length > 0, 'must find incoming neighbors');
  assert(inc.some(n => n.id === bsql3.id), 'better-sqlite3 must be an incoming neighbor of SQLite');
  assert(inc.every(n => n.direction === 'in'), 'direction must be "in"');
});

// ── G-7: neighbors() — both directions (default) ─────────────────────────────
test('G-7. neighbors() both — returns in + out without duplicates', () => {
  // Add a second relationship pointing TO better-sqlite3
  const hive = entities.create({ name: 'HIVE', entity_type: 'project' });
  const bsql3 = entities.findByName('better-sqlite3')[0];
  graph.link({ from_id: hive.id, rel_type: 'USES', to_id: bsql3.id });

  const both = graph.neighbors(bsql3.id); // default direction='both'
  const ids  = both.map(n => n.rel_id);
  const unique = new Set(ids);
  assert.strictEqual(ids.length, unique.size, 'no duplicate relationships in result');
  // bsql3 → SQLite (out from bsql3's perspective = incoming to bsql3? No, we query from bsql3)
  // bsql3 has outgoing DEPENDS_ON → SQLite
  // bsql3 has incoming USES from HIVE
  assert(both.some(n => n.id === hive.id),   'HIVE must appear (incoming to bsql3)');
  // SQLite is outgoing from bsql3
  const sqlite = entities.findByName('SQLite')[0];
  assert(both.some(n => n.id === sqlite.id), 'SQLite must appear (outgoing from bsql3)');
});

// ── G-8: neighbors() — relType filter ────────────────────────────────────────
test('G-8. neighbors() relType filter — returns only matching relationship type', () => {
  const bsql3 = entities.findByName('better-sqlite3')[0];

  const dependsOnly = graph.neighbors(bsql3.id, { relType: 'DEPENDS_ON' });
  assert(dependsOnly.every(n => n.rel_type === 'DEPENDS_ON'), 'all results must be DEPENDS_ON');

  const usesOnly = graph.neighbors(bsql3.id, { direction: 'in', relType: 'USES' });
  assert(usesOnly.length > 0, 'must find USES relationships incoming to bsql3');
  assert(usesOnly.every(n => n.rel_type === 'USES'), 'all must be USES type');
});

// ── G-9: Merge entities — relationships rerouted ─────────────────────────────
test('G-9. merge() — relationships rerouted, dropped entity deleted', () => {
  const a = entities.create({ name: 'Akhilesh', entity_type: 'person' });
  const b = entities.create({ name: 'AK',       entity_type: 'person' });
  const tool = entities.findByName('Node.js')[0];

  graph.link({ from_id: b.id, rel_type: 'USES', to_id: tool.id });

  entities.merge(a.id, b.id); // keep A, drop B

  assert(!entities.get(b.id), 'dropped entity must be deleted');
  assert(entities.get(a.id),  'kept entity must still exist');

  // The relationship that was from B→tool must now be from A→tool
  const neighbors = graph.neighbors(a.id, { direction: 'out' });
  assert(neighbors.some(n => n.id === tool.id), 'rerouted USES rel must now appear on kept entity');
});

// ── G-10: relatedMemories — finds memories mentioning entity name ─────────────
test('G-10. relatedMemories() — returns memories that mention the entity', () => {
  // Add a memory that explicitly mentions SQLite
  memory.add({
    title: 'SQLite WAL mode enables concurrent reads',
    content: 'SQLite in WAL mode allows concurrent readers while a single writer holds the lock.',
    memory_type: 'semantic', trust_level: 'SOURCE_VERIFIED', importance: 8,
  });

  const sqlite = entities.findByName('SQLite')[0];
  const related = graph.relatedMemories(sqlite.id);
  assert(related.length > 0, 'must find memories that mention SQLite');
  const titlesAndContent = related.map(m => m.title + ' ' + m.content).join(' ').toLowerCase();
  assert(titlesAndContent.includes('sqlite'), 'retrieved memories must mention SQLite');
});

// ── Cleanup ───────────────────────────────────────────────────────────────────
const { closeDb } = require('../src/db');
closeDb();
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);

console.log(`\n${pass + fail} tests: ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
