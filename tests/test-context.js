'use strict';
// HIVE Phase 2 — Context router tests.
// Run: node tests/test-context.js

const assert = require('assert');
const path   = require('path');
const fs     = require('fs');

const TEST_DB = path.join(__dirname, '..', 'database', 'hive-context-test.db');
process.env.HIVE_DB = TEST_DB;

fs.mkdirSync(path.dirname(TEST_DB), { recursive: true });
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);

const memory      = require('../src/memory');
const projects    = require('../src/projects');
const { buildContext } = require('../src/context');

let pass = 0, fail = 0;

function test(name, fn) {
  try { fn(); console.log(`  ✅  ${name}`); pass++; }
  catch (e) { console.error(`  ❌  ${name}\n      ${e.message}`); fail++; }
}

console.log('\nHIVE — Phase 2 context router tests\n');

// ── Seed data ─────────────────────────────────────────────────────────────

const projSQL = projects.create({
  name: 'Amazon SQL Reconciliation',
  objective: 'Build and maintain SQL queries to reconcile Amazon order data',
  domain: 'data-analytics',
});

const projUC = projects.create({
  name: 'UC Automation Pipeline',
  objective: 'Automate UC order processing via Node.js and Google Sheets',
  domain: 'professional-work',
});

const projHIVE = projects.create({
  name: 'HIVE',
  objective: 'Build the HIVE personal AI memory system',
  domain: 'software-engineering',
});

// Project memories
memory.add({
  title: 'Amazon reconciliation query v3',
  content: 'SELECT order_id, SUM(amount) FROM orders WHERE source="amazon" GROUP BY order_id. Fixed double-count by pre-aggregating shipments.',
  memory_type: 'project', project_id: projSQL.id, domain: 'data-analytics',
  trust_level: 'USER_CONFIRMED', importance: 9,
});
memory.add({
  title: 'Amazon SC session expires in 30 days',
  content: 'Amazon Seller Central uses a sliding-window session. Cookies expire 30 days after last activity.',
  memory_type: 'project', project_id: projSQL.id, domain: 'data-analytics',
  trust_level: 'SOURCE_VERIFIED', importance: 8,
});
memory.add({
  title: 'UC pipeline runs every 30 min',
  content: 'The scheduler.js runs the UC automation pipeline on a 30-minute cron. Logs to scheduler.log.',
  memory_type: 'project', project_id: projUC.id, domain: 'professional-work',
  trust_level: 'OBSERVED', importance: 7,
});
memory.add({
  title: 'HIVE SQLite schema v1',
  content: 'hive.db contains: memories, projects, entities, relationships, sources, audit_log, memories_fts (FTS5).',
  memory_type: 'project', project_id: projHIVE.id, domain: 'software-engineering',
  trust_level: 'USER_CONFIRMED', importance: 9,
});

// Skill (global — no project)
memory.add({
  title: 'SQL join validation skill',
  content: 'When a SQL query double-counts: 1) check join key uniqueness, 2) add DISTINCT, 3) pre-aggregate in subquery.',
  memory_type: 'skill', trust_level: 'USER_CONFIRMED', importance: 9,
  retrieval_keywords: 'double counting duplicate rows join validation cartesian product sql',
});

// ── Tests ─────────────────────────────────────────────────────────────────

// CT-1: Detects correct project for a task
test('CT-1. Project detection — SQL reconciliation task → Amazon SQL project', () => {
  const ctx = buildContext('debug the Amazon SQL reconciliation query');
  assert(ctx.project, 'Project must be detected');
  assert.strictEqual(ctx.project.id, projSQL.id, `Expected Amazon SQL project, got: ${ctx.project?.name}`);
  assert(ctx.project.confidence > 0, 'Confidence must be > 0');
});

// CT-2: Memories scoped to detected project
test('CT-2. Project isolation in context — UC task returns only UC memories', () => {
  const ctx = buildContext('check the UC pipeline cron scheduler log');
  assert(ctx.project, 'Project must be detected');
  assert.strictEqual(ctx.project.id, projUC.id, `Expected UC Automation project, got: ${ctx.project?.name}`);
  // All project-scoped memories must belong to UC
  const projectMems = ctx.memories.filter(m => m.project_id);
  assert(
    projectMems.every(m => m.project_id === projUC.id),
    'All project memories must belong to UC Automation, not other projects'
  );
});

// CT-3: Skills appear regardless of project
test('CT-3. Skill retrieval across projects — SQL skill found for SQL task', () => {
  const ctx = buildContext('my Amazon query is double counting duplicate rows');
  const hasSkill = ctx.memories.some(m => m.memory_type === 'skill');
  assert(hasSkill, 'SQL join validation skill must appear in context');
  assert(ctx.skills.length > 0, 'skills[] must be non-empty');
});

// CT-4: No project detected → no crash, global memories returned
test('CT-4. No project detected — task with no matching project returns memories gracefully', () => {
  const ctx = buildContext('what is photosynthesis and how does it work');
  // Should not throw. Memories may be empty. Project may be null.
  assert(Array.isArray(ctx.memories), 'memories must be an array');
  assert(Array.isArray(ctx.warnings), 'warnings must be an array');
  // no_domain or low_confidence warning expected
  const hasWarning = ctx.warnings.some(w => w.type === 'no_domain' || w.type === 'low_confidence');
  assert(hasWarning, 'Must warn when no domain/memories found for unrecognised task');
});

// CT-5: Explicit project override
test('CT-5. Explicit --project override — forces project regardless of task text', () => {
  const ctx = buildContext('something unrelated to any project', { projectId: projHIVE.id });
  assert(ctx.project, 'Project must be set');
  assert.strictEqual(ctx.project.id, projHIVE.id, 'Must use the explicitly provided project');
  assert.strictEqual(ctx.project.confidence, 1.0, 'Confidence must be 1.0 for explicit override');
});

// CT-6: Token budget enforced
test('CT-6. Token budget — context pack stays within budget', () => {
  const ctx = buildContext('Amazon SQL reconciliation', { budget: 100 });
  assert(ctx.tokenEstimate <= 100 + 50, // allow small overshoot from project header
    `Token estimate ${ctx.tokenEstimate} should be near or under budget 100`);
});

// CT-7: Ambiguity warning when two projects closely match
test('CT-7. Ambiguity detection — two similar projects → warning issued', () => {
  // Create a second Amazon project so both match
  const projSQL2 = projects.create({
    name: 'Amazon Installation SQL Reports',
    objective: 'SQL queries to reconcile Amazon installation data',
    domain: 'data-analytics',
  });
  memory.add({
    title: 'Amazon install SQL query',
    content: 'SELECT installation_id FROM amazon_installs WHERE status="complete"',
    memory_type: 'project', project_id: projSQL2.id, domain: 'data-analytics',
    trust_level: 'OBSERVED', importance: 7,
  });

  const ctx = buildContext('debug the Amazon SQL reconciliation query');
  const ambiguityWarn = ctx.warnings.find(w => w.type === 'ambiguous_project');
  assert(ambiguityWarn, 'Ambiguity warning must be present when two Amazon SQL projects match');
  assert(ambiguityWarn.alternatives.length > 0, 'Must list alternative projects in the warning');
});

// CT-8: Domain correctly detected
test('CT-8. Domain detection — SQL query task → data-analytics domain', () => {
  const ctx = buildContext('write a SQL query to count unique orders by column');
  assert(ctx.domain, 'Domain must be detected');
  assert.strictEqual(ctx.domain.name, 'data-analytics', `Expected data-analytics, got: ${ctx.domain?.name}`);
});

// CT-9: Cross-project disabled by default (project A memories excluded from project B task)
test('CT-9. Cross-project OFF by default — UC task does not return HIVE memories', () => {
  const ctx = buildContext('check the UC pipeline cron scheduler', { crossProject: false });
  const hiveMemories = ctx.memories.filter(m => m.project_id === projHIVE.id);
  assert.strictEqual(hiveMemories.length, 0, 'HIVE memories must not appear in UC task context (no cross-project)');
});

// CT-10: JSON output structure is complete
test('CT-10. Output structure — all required fields present', () => {
  const ctx = buildContext('Amazon reconciliation query');
  assert('task'          in ctx, 'missing: task');
  assert('domain'        in ctx, 'missing: domain');
  assert('project'       in ctx, 'missing: project');
  assert('memories'      in ctx, 'missing: memories');
  assert('skills'        in ctx, 'missing: skills');
  assert('warnings'      in ctx, 'missing: warnings');
  assert('tokenEstimate' in ctx, 'missing: tokenEstimate');
  assert('budget'        in ctx, 'missing: budget');
  assert(Array.isArray(ctx.memories), 'memories must be array');
  assert(Array.isArray(ctx.skills),   'skills must be array');
  assert(Array.isArray(ctx.warnings), 'warnings must be array');
  assert(typeof ctx.tokenEstimate === 'number', 'tokenEstimate must be number');
});

// ── Cleanup ───────────────────────────────────────────────────────────────
const { closeDb } = require('../src/db');
closeDb();
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);

console.log(`\n${pass + fail} tests: ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
