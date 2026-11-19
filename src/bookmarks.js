'use strict';
const { getDb } = require('./db');

const VALID_MODES = ['keyword', 'semantic', 'hybrid'];

function add(name, query, mode = 'keyword') {
  if (!name || !name.trim()) throw new Error('name is required');
  if (!query || !query.trim()) throw new Error('query is required');
  if (!VALID_MODES.includes(mode)) throw new Error(`mode must be one of: ${VALID_MODES.join(', ')}`);
  getDb().prepare(
    'INSERT INTO search_bookmarks (name, query, mode, created_at) VALUES (?,?,?,?)'
  ).run(name.trim(), query.trim(), mode, Date.now());
  return getDb().prepare('SELECT * FROM search_bookmarks WHERE name=?').get(name.trim());
}

function list() {
  return getDb().prepare('SELECT * FROM search_bookmarks ORDER BY name').all();
}

function get(name) {
  return getDb().prepare('SELECT * FROM search_bookmarks WHERE name=?').get(name) || null;
}

function remove(id) {
  return getDb().prepare('DELETE FROM search_bookmarks WHERE id=?').run(id).changes;
}

module.exports = { add, list, get, remove, VALID_MODES };
