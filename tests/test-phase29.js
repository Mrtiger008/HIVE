'use strict';
const assert = require('assert');
const templates = require('../src/templates');

let passed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n    ${e.message}`); }
}

console.log('\nPhase 29 — Memory Templates\n');

// P-1: list() returns all 6 types
test('P-1  list() returns 6 templates', () => {
  assert.strictEqual(templates.list().length, 6);
});

// P-2: all types are present
test('P-2  all memory types are covered', () => {
  const types = new Set(templates.list().map(t => t.memory_type));
  for (const t of ['core','domain','project','episodic','semantic','skill'])
    assert.ok(types.has(t), `missing: ${t}`);
});

// P-3: each template has required fields
test('P-3  each template has required fields', () => {
  for (const tpl of templates.list()) {
    assert.ok('memory_type'  in tpl, `${tpl.memory_type} missing memory_type`);
    assert.ok('trust_level'  in tpl, `${tpl.memory_type} missing trust_level`);
    assert.ok('importance'   in tpl, `${tpl.memory_type} missing importance`);
    assert.ok('confidence'   in tpl, `${tpl.memory_type} missing confidence`);
    assert.ok(Array.isArray(tpl.tags), `${tpl.memory_type} tags not array`);
  }
});

// P-4: get() returns correct template
test('P-4  get("core") returns core template', () => {
  const tpl = templates.get('core');
  assert.strictEqual(tpl.memory_type, 'core');
  assert.strictEqual(tpl.trust_level, 'USER_CONFIRMED');
});

// P-5: core template has high importance
test('P-5  core template importance >= 7', () => {
  assert.ok(templates.get('core').importance >= 7);
});

// P-6: skill template includes "howto" tag
test('P-6  skill template includes howto tag', () => {
  assert.ok(templates.get('skill').tags.includes('howto'));
});

// P-7: skill template has content hint
test('P-7  skill template has content_hint with Steps', () => {
  assert.ok(templates.get('skill').content_hint.includes('Steps'));
});

// P-8: get() falls back to semantic for unknown type
test('P-8  get("unknown") falls back to semantic', () => {
  assert.strictEqual(templates.get('unknown').memory_type, 'semantic');
});

// P-9: confidence values are in [0,1]
test('P-9  all confidences are in [0,1]', () => {
  for (const tpl of templates.list()) {
    assert.ok(tpl.confidence >= 0 && tpl.confidence <= 1,
      `${tpl.memory_type}: confidence ${tpl.confidence} out of range`);
  }
});

// P-10: importance values are in [1,10]
test('P-10 all importances are in [1,10]', () => {
  for (const tpl of templates.list()) {
    assert.ok(tpl.importance >= 1 && tpl.importance <= 10,
      `${tpl.memory_type}: importance ${tpl.importance} out of range`);
  }
});

console.log(`\n${passed}/10 passed\n`);
