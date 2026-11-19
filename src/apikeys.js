'use strict';
const crypto = require('crypto');
const { getDb } = require('./db');

function _hash(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

function generate(name) {
  const key = 'hive_' + crypto.randomBytes(24).toString('hex');
  getDb().prepare('INSERT INTO api_keys (name, key_hash, created_at) VALUES (?,?,?)')
    .run(name, _hash(key), Date.now());
  return key; // returned once only — never stored in plain text
}

function verify(key) {
  if (!key || !key.startsWith('hive_')) return false;
  const row = getDb().prepare('SELECT id FROM api_keys WHERE key_hash = ?').get(_hash(key));
  if (row) {
    getDb().prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').run(Date.now(), row.id);
    return true;
  }
  return false;
}

function list() {
  return getDb().prepare(
    'SELECT id, name, created_at, last_used_at FROM api_keys ORDER BY created_at DESC'
  ).all();
}

function revoke(name) {
  return getDb().prepare('DELETE FROM api_keys WHERE name = ?').run(name).changes;
}

function hasAny() {
  return !!getDb().prepare('SELECT 1 FROM api_keys LIMIT 1').get();
}

module.exports = { generate, verify, list, revoke, hasAny };
