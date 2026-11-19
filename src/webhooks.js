'use strict';
const https = require('https');
const http  = require('http');
const { getDb } = require('./db');

function list() {
  return getDb().prepare('SELECT * FROM webhooks ORDER BY created_at DESC').all()
    .map(w => ({ ...w, events: JSON.parse(w.events) }));
}

function add(url, events = ['*']) {
  if (!url || !/^https?:\/\/.+/.test(url)) throw new Error('url must be a valid http/https URL');
  getDb().prepare('INSERT INTO webhooks (url, events, created_at) VALUES (?,?,?)')
    .run(url, JSON.stringify(events), Date.now());
  return getDb().prepare('SELECT * FROM webhooks WHERE url = ?').get(url);
}

function remove(id) {
  return getDb().prepare('DELETE FROM webhooks WHERE id = ?').run(id).changes;
}

function _matches(webhookEvents, eventName) {
  return webhookEvents.includes('*') || webhookEvents.includes(eventName);
}

// Fire-and-forget: POST payload to all active matching webhooks.
// Never throws — errors are stored in last_status.
function fire(eventName, data) {
  const hooks = list().filter(w => w.active && _matches(w.events, eventName));
  if (!hooks.length) return;
  const payload = Buffer.from(JSON.stringify({ event: eventName, timestamp: Date.now(), data }));
  for (const hook of hooks) {
    try {
      const u = new URL(hook.url);
      const transport = u.protocol === 'https:' ? https : http;
      const req = transport.request({
        hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length, 'X-Hive-Event': eventName },
      }, res => {
        const ok = res.statusCode >= 200 && res.statusCode < 300;
        getDb().prepare('UPDATE webhooks SET last_triggered_at=?, last_status=? WHERE id=?')
          .run(Date.now(), ok ? 'ok' : `HTTP ${res.statusCode}`, hook.id);
        res.resume(); // drain response body
      });
      req.on('error', err => {
        try { getDb().prepare('UPDATE webhooks SET last_triggered_at=?, last_status=? WHERE id=?')
          .run(Date.now(), err.message.slice(0, 120), hook.id); } catch {}
      });
      req.setTimeout(5000, () => req.destroy());
      req.write(payload);
      req.end();
    } catch (err) {
      try { getDb().prepare('UPDATE webhooks SET last_status=? WHERE id=?')
        .run(err.message.slice(0, 120), hook.id); } catch {}
    }
  }
}

module.exports = { list, add, remove, fire };
