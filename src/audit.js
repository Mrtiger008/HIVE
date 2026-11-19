'use strict';
const path = require('path');
const fs = require('fs');
const { getDb } = require('./db');

const LOG_PATH = path.join(__dirname, '..', 'logs', 'audit.log');

function auditLog(action, entityType, entityId, details) {
  const now = Date.now();
  const detailStr = typeof details === 'string' ? details : JSON.stringify(details);

  try {
    getDb().prepare(
      'INSERT INTO audit_log (action, entity_type, entity_id, details, timestamp) VALUES (?, ?, ?, ?, ?)'
    ).run(action, entityType, entityId, detailStr, now);
  } catch {}

  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH,
      `${new Date(now).toISOString()} | ${action} | ${entityType}:${entityId} | ${detailStr}\n`,
      'utf8');
  } catch {}
}

module.exports = { auditLog };
