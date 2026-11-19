'use strict';
const assert = require('assert');
const path = require('path');
const os = require('os');
const http = require('http');

const DB = path.join(os.tmpdir(), `hive-test-p26-${Date.now()}.db`);
process.env.HIVE_DB = DB;

const { getDb, closeDb } = require('../src/db');
const webhooks = require('../src/webhooks');

let passed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n    ${e.message}`); }
}

// Ensure schema is initialised
getDb();

console.log('\nPhase 26 — Webhook Push Notifications\n');

// W-1: list empty
test('W-1  list() returns empty array initially', () => {
  assert.deepStrictEqual(webhooks.list(), []);
});

// W-2: add valid webhook
test('W-2  add() inserts and returns the webhook', () => {
  const w = webhooks.add('http://localhost:9999/hook');
  assert.ok(w.id);
  assert.strictEqual(w.url, 'http://localhost:9999/hook');
});

// W-3: list shows added webhook
test('W-3  list() shows registered webhook', () => {
  const all = webhooks.list();
  assert.ok(all.length >= 1);
  assert.ok(all.some(w => w.url === 'http://localhost:9999/hook'));
});

// W-4: events default to ['*']
test('W-4  default events is [*]', () => {
  const w = webhooks.list().find(w => w.url === 'http://localhost:9999/hook');
  assert.deepStrictEqual(w.events, ['*']);
});

// W-5: add with custom events
test('W-5  add() with custom events', () => {
  const w = webhooks.add('http://localhost:9998/hook', ['memory.created', 'memory.updated']);
  assert.deepStrictEqual(w.events ? JSON.parse(w.events) : null, ['memory.created', 'memory.updated']);
});

// W-6: list parses events JSON
test('W-6  list() returns parsed events array', () => {
  const all = webhooks.list();
  for (const w of all) assert.ok(Array.isArray(w.events), `events should be array for ${w.url}`);
});

// W-7: duplicate URL rejected
test('W-7  add() rejects duplicate URL', () => {
  assert.throws(() => webhooks.add('http://localhost:9999/hook'), /UNIQUE|url already/i);
});

// W-8: invalid URL rejected
test('W-8  add() rejects non-http URL', () => {
  assert.throws(() => webhooks.add('ftp://example.com'), /valid http/i);
});

// W-9: remove() deletes by id
test('W-9  remove() deletes webhook and returns 1', () => {
  const w = webhooks.add('http://localhost:9997/hook');
  const changes = webhooks.remove(w.id);
  assert.strictEqual(changes, 1);
  assert.ok(!webhooks.list().some(x => x.id === w.id));
});

// W-10: remove() non-existent returns 0
test('W-10 remove() non-existent id returns 0', () => {
  assert.strictEqual(webhooks.remove(99999), 0);
});

console.log(`\n${passed}/10 passed\n`);

closeDb();
