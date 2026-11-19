'use strict';
// HIVE Phase 8 — Entity Extraction / Auto-tagging tests.
// Run: node tests/test-extract.js

const assert = require('assert');
const path   = require('path');
const fs     = require('fs');

const TEST_DB = path.join(__dirname, '..', 'database', 'hive-extract-test.db');
process.env.HIVE_DB = TEST_DB;

fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);

const memory   = require('../src/memory');
const entities = require('../src/entities');
const { detectMentions, extractAndLink, linkedEntities, linkedMemories, backfill } = require('../src/extract');
const { getDb, closeDb } = require('../src/db');

let pass = 0, fail = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✅  ${name}`); pass++;
  } catch (e) { console.error(`  ❌  ${name}\n      ${e.message}`); fail++; }
}

console.log('\nHIVE — Phase 8 entity extraction tests\n');

// ── Helpers ──────────────────────────────────────────────────────────────────

function addEntity(name, type = 'tool', aliases = []) {
  return entities.create({ name, entity_type: type, aliases });
}

function addMem(title, content) {
  return memory.add({
    title, content: content || title,
    memory_type: 'semantic', trust_level: 'OBSERVED', importance: 5,
  });
}

// ── E-1: detectMentions — finds entity name in text ──────────────────────────
test('E-1. detectMentions — finds entity name in text', () => {
  const e = addEntity('PostgreSQL', 'tool');
  const hits = detectMentions('We migrated to PostgreSQL last week');
  assert(hits.length > 0, 'should find at least one entity');
  assert(hits.some(h => h.entity.id === e.id), 'PostgreSQL entity must be in hits');
});

// ── E-2: detectMentions — case-insensitive match ──────────────────────────────
test('E-2. detectMentions — case-insensitive match', () => {
  const e = addEntity('Redis', 'tool');
  const hits = detectMentions('cache layer uses redis for session storage');
  assert(hits.some(h => h.entity.id === e.id), 'redis (lowercase) must match Redis entity');
});

// ── E-3: detectMentions — skips entity names shorter than 3 chars ─────────────
test('E-3. detectMentions — skips names < 3 chars', () => {
  addEntity('JS', 'tool'); // 2 chars — must be skipped
  const hits = detectMentions('building JS apps with node');
  const jsHit = hits.find(h => h.entity.name === 'JS');
  assert(!jsHit, 'JS (2-char name) must not appear in hits');
});

// ── E-4: detectMentions — alias match ────────────────────────────────────────
test('E-4. detectMentions — matches on entity alias', () => {
  const e = addEntity('Node.js', 'tool', ['node', 'nodejs']);
  const hits = detectMentions('running nodejs server on port 3000');
  assert(hits.some(h => h.entity.id === e.id), 'nodejs alias must match Node.js entity');
});

// ── E-5: extractAndLink — creates memory_entity_links rows ───────────────────
test('E-5. extractAndLink — persists links in DB', () => {
  const e = addEntity('SQLite', 'tool');
  const m = addMem('SQLite performance notes', 'SQLite is fast for reads');
  // memory.add already auto-calls extractAndLink; check the link exists
  const rows = getDb().prepare('SELECT * FROM memory_entity_links WHERE memory_id = ?').all(m.id);
  assert(rows.length > 0, 'at least one link must be created');
  assert(rows.some(r => r.entity_id === e.id), 'SQLite entity must be linked');
});

// ── E-6: linkedEntities — returns entities for a memory ──────────────────────
test('E-6. linkedEntities — returns entities linked to a memory', () => {
  const e = addEntity('Webpack', 'tool');
  const m = addMem('Webpack bundle config', 'Configure Webpack for production builds');
  // force a fresh extraction (auto-link already happened but let's verify the read path)
  extractAndLink(m.id, { title: m.title, content: m.content });
  const linked = linkedEntities(m.id);
  assert(linked.length > 0, 'must return at least one linked entity');
  assert(linked.some(l => l.id === e.id), 'Webpack entity must be in linkedEntities');
});

// ── E-7: linkedMemories — returns memories linked to an entity ────────────────
test('E-7. linkedMemories — returns memories mentioning an entity', () => {
  const e = addEntity('Kubernetes', 'tool');
  const m1 = addMem('Kubernetes pod scaling', 'Kubernetes scales pods horizontally');
  const m2 = addMem('Kubernetes ingress config', 'Kubernetes ingress controller setup');
  const linked = linkedMemories(e.id);
  assert(linked.length >= 2, `expected >= 2 linked memories, got ${linked.length}`);
  const ids = linked.map(m => m.id);
  assert(ids.includes(m1.id) && ids.includes(m2.id), 'both Kubernetes memories must appear');
});

// ── E-8: memory.add() auto-extracts on creation ───────────────────────────────
test('E-8. memory.add() — auto-extracts entity mentions on creation', () => {
  const e = addEntity('Terraform', 'tool');
  const m = addMem('Terraform state management', 'Terraform stores state in remote backends');
  // Auto-extraction happens inside memory.add() — just verify the link exists without calling extract manually
  const linked = linkedEntities(m.id);
  assert(linked.some(l => l.id === e.id), 'Terraform must be auto-linked on memory.add()');
});

// ── E-9: backfill — processes memories without entity links ───────────────────
test('E-9. backfill — links memories that have no entity links', () => {
  const e = addEntity('Ansible', 'tool');
  // Manually insert a memory bypassing memory.add() to avoid auto-extraction
  const { randomUUID } = require('crypto');
  const id = randomUUID();
  const now = Date.now();
  getDb().prepare(`
    INSERT INTO memories (id, title, content, memory_type, trust_level, status, importance, confidence, tags, created_at, updated_at)
    VALUES (?, 'Ansible playbook notes', 'Ansible playbook for server provisioning', 'semantic', 'OBSERVED', 'active', 5, 0.5, '[]', ?, ?)
  `).run(id, now, now);
  // FTS5 trigger should fire automatically for the insert, but let's focus on backfill
  const before = getDb().prepare('SELECT COUNT(*) as n FROM memory_entity_links WHERE memory_id = ?').get(id).n;
  assert.strictEqual(before, 0, 'memory should have 0 links before backfill');
  backfill({ limit: 10 });
  const after = getDb().prepare('SELECT COUNT(*) as n FROM memory_entity_links WHERE memory_id = ?').get(id).n;
  assert(after > 0, `backfill should have created links; got ${after}`);
});

// ── E-10: backfill — skips already-linked memories ───────────────────────────
test('E-10. backfill — skips memories that already have entity links', () => {
  const e = addEntity('Grafana', 'tool');
  const m = addMem('Grafana dashboards', 'Grafana dashboard for monitoring');
  // m already has links from auto-extraction in memory.add()
  const linksBefore = getDb().prepare('SELECT COUNT(*) as n FROM memory_entity_links WHERE memory_id = ?').get(m.id).n;
  assert(linksBefore > 0, 'must already have links from auto-extraction');
  const result = backfill({ limit: 10 });
  // m was already linked so backfill should not process it
  // (the NOT EXISTS filter skips it)
  const linksAfter = getDb().prepare('SELECT COUNT(*) as n FROM memory_entity_links WHERE memory_id = ?').get(m.id).n;
  assert.strictEqual(linksAfter, linksBefore, 'link count should not change for already-linked memory');
});

// ── Cleanup ───────────────────────────────────────────────────────────────────
closeDb();
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
console.log(`\n${pass + fail} tests: ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
