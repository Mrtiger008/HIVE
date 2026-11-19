'use strict';
const http = require('http');
const path = require('path');
const fs   = require('fs');

const { getDb, DB_PATH } = require('./db');
const { search }       = require('./search');
const { topKeywords }  = require('./patterns');
const memory           = require('./memory');
const entities         = require('./entities');
const projects         = require('./projects');
const apikeys          = require('./apikeys');
const webhooks         = require('./webhooks');
const versions         = require('./versions');
const tags             = require('./tags');
const templates        = require('./templates');
const kstats           = require('./stats');

// ── Helpers ───────────────────────────────────────────────────────────────────

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); } });
    req.on('error', reject);
  });
}

// ── Route handlers ────────────────────────────────────────────────────────────

function handleStats(req, res) {
  const db = getDb();
  json(res, {
    memories: db.prepare("SELECT COUNT(*) as n FROM memories WHERE status='active'").get().n,
    entities: db.prepare("SELECT COUNT(*) as n FROM entities").get().n,
    projects: db.prepare("SELECT COUNT(*) as n FROM projects WHERE status='active'").get().n,
  });
}

function recordQuery(query) {
  try {
    getDb().prepare('INSERT INTO search_history (query, searched_at) VALUES (?, ?)').run(query.trim(), Date.now());
  } catch {}
}

function handleActivity(req, res, q) {
  const limit = +(q.limit) || 50;
  const rows = getDb().prepare(`
    SELECT a.id, a.action, a.entity_type, a.entity_id, a.details, a.timestamp,
           m.title AS memory_title
    FROM audit_log a
    LEFT JOIN memories m ON a.entity_id = m.id AND a.entity_type = 'memory'
    ORDER BY a.timestamp DESC
    LIMIT ?
  `).all(limit);
  const now = Date.now();
  json(res, rows.map(r => {
    const secs = Math.floor((now - r.timestamp) / 1000);
    const time_ago = secs < 60 ? `${secs}s ago`
      : secs < 3600 ? `${Math.floor(secs/60)}m ago`
      : secs < 86400 ? `${Math.floor(secs/3600)}h ago`
      : `${Math.floor(secs/86400)}d ago`;
    let details_parsed = null;
    try { details_parsed = JSON.parse(r.details); } catch { details_parsed = r.details; }
    return { id: r.id, action: r.action, entity_type: r.entity_type, entity_id: r.entity_id,
             title: r.memory_title || null, details: details_parsed, timestamp: r.timestamp, time_ago };
  }));
}

function handleTags(req, res) {
  const rows = getDb().prepare("SELECT tags FROM memories WHERE status='active' AND tags IS NOT NULL AND tags != '[]'").all();
  const counts = {};
  for (const { tags } of rows) {
    for (const t of JSON.parse(tags || '[]')) {
      counts[t] = (counts[t] || 0) + 1;
    }
  }
  json(res, Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([tag, count]) => ({ tag, count })));
}

function handleSearchHistory(req, res, q) {
  const limit = +(q.limit) || 20;
  const rows = getDb().prepare(
    'SELECT query, MAX(searched_at) as last_used, COUNT(*) as times FROM search_history GROUP BY query ORDER BY last_used DESC LIMIT ?'
  ).all(limit);
  json(res, rows);
}

function handleSearch(req, res, q) {
  const query = q.q || '';
  const limit = +(q.limit) || 20;
  const projectId = q.project || null;
  const mode = q.mode || 'keyword';
  if (!query.trim()) { json(res, []); return; }
  recordQuery(query);
  if (mode === 'semantic' || mode === 'hybrid') {
    try {
      const sem = require('./semantic');
      sem.search(query, { limit, projectId, hybrid: mode === 'hybrid' })
        .then(results => json(res, results))
        .catch(() => json(res, search(query, { limit, project_id: projectId })));
      return;
    } catch { /* fall through to keyword */ }
  }
  json(res, search(query, { limit, project_id: projectId }));
}

function handleMemories(req, res, q) {
  let results = memory.list({
    type:        q.type    || undefined,
    trust_level: q.trust   || undefined,
    project_id:  q.project || undefined,
    limit:       +(q.limit) || 50,
    min_conf:    q.min_conf != null ? +q.min_conf : undefined,
    max_conf:    q.max_conf != null ? +q.max_conf : undefined,
  });
  if (q.tag) results = results.filter(m => (m.tags || []).includes(q.tag));
  json(res, results);
}

function handlePatterns(req, res, q) {
  json(res, topKeywords({ days: +(q.days) || 30, limit: +(q.limit) || 20 }));
}

function handleEntities(req, res, q) {
  const rows = getDb().prepare(
    'SELECT * FROM entities ORDER BY created_at DESC LIMIT ?'
  ).all(+(q.limit) || 100);
  json(res, rows.map(e => ({ ...e, aliases: JSON.parse(e.aliases || '[]') })));
}

function handleGraph(req, res, q) {
  const db = getDb();
  const limit = +(q.limit) || 100;
  let sql = 'SELECT id, name, entity_type FROM entities WHERE 1=1';
  const params = [];
  if (q.type)   { sql += ' AND entity_type = ?'; params.push(q.type); }
  if (q.search) { sql += ' AND name LIKE ?';     params.push(`%${q.search}%`); }
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);
  const nodes = db.prepare(sql).all(...params);
  const nodeIds = new Set(nodes.map(n => n.id));
  const edges = db.prepare('SELECT from_id, to_id, rel_type, confidence FROM relationships').all()
    .filter(r => nodeIds.has(r.from_id) && nodeIds.has(r.to_id));
  // attach degree count so frontend can size nodes
  const degree = {};
  for (const e of edges) {
    degree[e.from_id] = (degree[e.from_id] || 0) + 1;
    degree[e.to_id]   = (degree[e.to_id]   || 0) + 1;
  }
  json(res, { nodes: nodes.map(n => ({ ...n, degree: degree[n.id] || 0 })), edges });
}

function handleProjects(req, res) {
  json(res, projects.list({ status: 'active', limit: 50 }));
}

function handleExport(req, res, q) {
  const { exportJson, exportCsv } = require('./export');
  const fmt = (q.format || 'json').toLowerCase();
  if (fmt === 'csv') {
    res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="hive-export.csv"' });
    res.end(exportCsv());
  } else {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="hive-export.json"' });
    res.end(exportJson());
  }
}

function handleReview(req, res, q) {
  const { stalest } = require('./decay');
  const limit = +(q.limit) || 20;
  const projectId = q.project || null;
  const now = Date.now();
  const MS = 86400000;
  const results = stalest({ projectId, limit }).map(m => ({
    ...m,
    days_idle: Math.round((now - (m.last_accessed_at || m.created_at)) / MS),
    urgency: (now - (m.last_accessed_at || m.created_at)) / MS > 90 ? 'critical'
           : (now - (m.last_accessed_at || m.created_at)) / MS > 30 ? 'warning' : 'ok',
  }));
  json(res, results);
}

function handleReinforce(req, res, id) {
  const { reinforce } = require('./reinforce');
  try { reinforce(id); json(res, { ok: true }); }
  catch (e) { res.writeHead(404); res.end(e.message); }
}

function handleProjectStats(req, res, id) {
  const p = projects.get(id);
  if (!p) { res.writeHead(404); res.end('Not Found'); return; }
  const db = getDb();
  const memCount = db.prepare("SELECT COUNT(*) as n FROM memories WHERE project_id=? AND status='active'").get(id).n;
  const entCount = db.prepare(
    "SELECT COUNT(DISTINCT mel.entity_id) as n FROM memory_entity_links mel JOIN memories m ON mel.memory_id=m.id WHERE m.project_id=? AND m.status='active'"
  ).get(id).n;
  json(res, { ...p, memory_count: memCount, entity_count: entCount });
}

async function handleBrief(req, res) {
  // Serve cached file if available, else generate (keyword-only, no model needed)
  const briefPath = path.join(path.dirname(DB_PATH), 'last-briefing.md');
  if (fs.existsSync(briefPath)) {
    json(res, { text: fs.readFileSync(briefPath, 'utf8') });
    return;
  }
  const { dailyBriefing } = require('./briefing');
  const result = await dailyBriefing({ budget: 1500 });
  json(res, { text: result.text });
}

async function handleAddMemory(req, res) {
  const body = await readBody(req);
  if (!body.title || !body.content) { json(res, { error: 'title and content required' }, 400); return; }
  const m = memory.add({
    title:       body.title,
    content:     body.content,
    memory_type: body.memory_type || 'semantic',
    trust_level: body.trust_level || 'OBSERVED',
    importance:  body.importance  ? +body.importance : 5,
    confidence:  body.confidence  != null ? Math.min(1, Math.max(0, +body.confidence)) : 0.5,
    tags:        body.tags        || [],
  });
  webhooks.fire('memory.created', { id: m.id, title: m.title, memory_type: m.memory_type, trust_level: m.trust_level, importance: m.importance });
  json(res, m, 201);
}

function handleGetMemory(req, res, id) {
  const m = memory.get(id);
  if (!m) { json(res, { error: 'not found' }, 404); return; }
  json(res, m);
}

async function handleUpdateMemory(req, res, id) {
  const m = memory.get(id);
  if (!m) { json(res, { error: 'not found' }, 404); return; }
  const body = await readBody(req);
  const updates = {};
  if (body.title       !== undefined) updates.title       = body.title;
  if (body.content     !== undefined) updates.content     = body.content;
  if (body.memory_type !== undefined) updates.memory_type = body.memory_type;
  if (body.trust_level !== undefined) updates.trust_level = body.trust_level;
  if (body.importance  !== undefined) updates.importance  = +body.importance;
  if (body.confidence  !== undefined) updates.confidence  = Math.min(1, Math.max(0, +body.confidence));
  if (body.tags        !== undefined) updates.tags        = body.tags;
  if (!Object.keys(updates).length) { json(res, { error: 'no fields to update' }, 400); return; }
  if (updates.title !== undefined || updates.content !== undefined)
    versions.snapshot(id, m.title, m.content);
  const updated = memory.update(id, updates);
  webhooks.fire('memory.updated', { id: updated.id, title: updated.title, memory_type: updated.memory_type, changes: Object.keys(updates) });
  json(res, updated);
}

async function handleDeleteMemory(req, res, id) {
  const m = memory.get(id);
  if (!m) { json(res, { error: 'not found' }, 404); return; }
  memory.update(id, { status: 'archived' });
  webhooks.fire('memory.archived', { id: m.id, title: m.title });
  json(res, { ok: true });
}

async function handleBulk(req, res) {
  const body = await readBody(req);
  const { ids, action, updates } = body;
  if (!Array.isArray(ids) || !ids.length) { json(res, { error: 'ids array required' }, 400); return; }
  if (!action) { json(res, { error: 'action required' }, 400); return; }
  let count = 0;
  for (const id of ids) {
    try {
      if (action === 'archive') { memory.update(id, { status: 'archived' }); count++; }
      else if (action === 'update' && updates) { memory.update(id, updates); count++; }
    } catch {}
  }
  json(res, { count });
}

function handleSimilar(req, res, q) {
  const { findSimilar } = require('./dedupe');
  const title     = q.title   || '';
  const content   = q.content || '';
  const threshold = q.threshold != null ? +q.threshold : 0.25;
  const limit     = +(q.limit) || 5;
  if (!title.trim() && !content.trim()) { json(res, []); return; }
  json(res, findSimilar(title, content, { threshold, limit })
    .map(m => ({ id: m.id, title: m.title, memory_type: m.memory_type, score: +m._score.toFixed(3) })));
}

function handleTagStats(req, res, q) {
  const limit = +(q.limit) || 50;
  const top = tags.topTags(limit);
  const coTag = q.co;
  const co = coTag ? tags.coOccurrence(coTag, 10) : [];
  json(res, { top, co, coTag: coTag || null });
}

function handleListVersions(req, res, id) {
  const m = memory.get(id);
  if (!m) { json(res, { error: 'not found' }, 404); return; }
  json(res, versions.list(id));
}

function handleGetVersion(req, res, vid) {
  const v = versions.get(+vid);
  if (!v) { json(res, { error: 'not found' }, 404); return; }
  const current = memory.get(v.memory_id);
  if (!current) { json(res, { error: 'memory not found' }, 404); return; }
  json(res, { version: v, diff: versions.diff(v.content, current.content) });
}

function handleListWebhooks(req, res) {
  json(res, webhooks.list());
}

async function handleAddWebhook(req, res) {
  const body = await readBody(req);
  if (!body.url) { json(res, { error: 'url required' }, 400); return; }
  try {
    const events = Array.isArray(body.events) ? body.events : ['*'];
    const w = webhooks.add(body.url, events);
    json(res, { ...w, events }, 201);
  } catch (e) {
    json(res, { error: e.message.includes('UNIQUE') ? 'url already registered' : e.message }, 409);
  }
}

async function handleDeleteWebhook(req, res, id) {
  const changes = webhooks.remove(+id);
  if (!changes) { json(res, { error: 'not found' }, 404); return; }
  json(res, { ok: true });
}

function handleListKeys(req, res) {
  json(res, apikeys.list().map(k => ({
    id: k.id, name: k.name,
    created_at: k.created_at,
    last_used_at: k.last_used_at || null,
  })));
}

async function handleCreateKey(req, res) {
  const body = await readBody(req);
  if (!body.name || !body.name.trim()) { json(res, { error: 'name required' }, 400); return; }
  try {
    const key = apikeys.generate(body.name.trim());
    json(res, { key }, 201); // returned once only
  } catch (e) {
    json(res, { error: e.message.includes('UNIQUE') ? 'name already exists' : e.message }, 409);
  }
}

async function handleRevokeKey(req, res, name) {
  const changes = apikeys.revoke(decodeURIComponent(name));
  if (!changes) { json(res, { error: 'not found' }, 404); return; }
  json(res, { ok: true });
}

function handleIndex(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(HTML);
}

const ROUTES = {
  'GET /api/stats':          handleStats,
  'GET /api/search':         handleSearch,
  'GET /api/search/history': handleSearchHistory,
  'GET /api/tags':           handleTags,
  'GET /api/activity':       handleActivity,
  'GET /api/memories':         handleMemories,
  'GET /api/memories/similar': handleSimilar,
  'POST /api/memories':        handleAddMemory,
  'POST /api/memories/bulk':   handleBulk,
  'GET /api/patterns':       handlePatterns,
  'GET /api/graph':          handleGraph,
  'GET /api/entities':       handleEntities,
  'GET /api/projects':       handleProjects,
  'GET /api/export':         handleExport,
  'GET /api/review':         handleReview,
  'GET /api/brief':          handleBrief,
  'GET /api/apikeys':        handleListKeys,
  'POST /api/apikeys':       handleCreateKey,
  'GET /api/templates':      (req, res) => json(res, templates.list()),
  'GET /api/stats/full':     (req, res) => json(res, kstats.full()),
  'GET /api/tags/stats':     (req, res) => { const u = new URL(req.url,'http://l'); handleTagStats(req, res, Object.fromEntries(u.searchParams)); },
  'GET /api/webhooks':       handleListWebhooks,
  'POST /api/webhooks':      handleAddWebhook,
  'GET /':                   handleIndex,
};

// Auth middleware: if any keys exist, require Bearer token on /api/* routes.
// Requests with X-Hive-Local: 1 header bypass auth (dashboard fetches).
function checkAuth(req, pathname) {
  if (!pathname.startsWith('/api/')) return true;
  if (!apikeys.hasAny()) return true; // open mode — no keys configured
  if (req.headers['x-hive-local'] === '1') return true;
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  return apikeys.verify(token);
}

// ── Server factory ────────────────────────────────────────────────────────────

function createServer() {
  return http.createServer((req, res) => {
    const u = new URL(req.url, 'http://localhost');
    const pathname = u.pathname;
    const query = Object.fromEntries(u.searchParams);
    let handler = ROUTES[`${req.method} ${pathname}`];
    if (!handler) {
      const m = pathname.match(/^\/api\/memories\/([^/]+)$/);
      if (m) {
        const id = m[1];
        if (req.method === 'GET')    handler = (req, res) => handleGetMemory(req, res, id);
        if (req.method === 'PUT')    handler = (req, res) => handleUpdateMemory(req, res, id);
        if (req.method === 'DELETE') handler = (req, res) => handleDeleteMemory(req, res, id);
      }
      const p = pathname.match(/^\/api\/projects\/([^/]+)\/stats$/);
      if (p && req.method === 'GET') {
        const id = p[1];
        handler = (req, res) => handleProjectStats(req, res, id);
      }
      const rf = pathname.match(/^\/api\/memories\/([^/]+)\/reinforce$/);
      if (rf && req.method === 'POST') {
        const id = rf[1];
        handler = (req, res) => handleReinforce(req, res, id);
      }
      const ak = pathname.match(/^\/api\/apikeys\/(.+)$/);
      if (ak && req.method === 'DELETE') {
        const name = ak[1];
        handler = (req, res) => handleRevokeKey(req, res, name);
      }
      const wh = pathname.match(/^\/api\/webhooks\/(\d+)$/);
      if (wh && req.method === 'DELETE') {
        handler = (req, res) => handleDeleteWebhook(req, res, wh[1]);
      }
      const mv = pathname.match(/^\/api\/memories\/([^/]+)\/versions$/);
      if (mv && req.method === 'GET') {
        handler = (req, res) => handleListVersions(req, res, mv[1]);
      }
      const vd = pathname.match(/^\/api\/versions\/(\d+)\/diff$/);
      if (vd && req.method === 'GET') {
        handler = (req, res) => handleGetVersion(req, res, vd[1]);
      }
    }
    if (!handler) { res.writeHead(404); res.end('Not Found'); return; }
    if (!checkAuth(req, pathname)) {
      json(res, { error: 'Unauthorized — provide Authorization: Bearer <key>' }, 401);
      return;
    }
    Promise.resolve(handler(req, res, query)).catch(err => {
      if (!res.headersSent) { res.writeHead(500); res.end(err.message); }
    });
  });
}

if (require.main === module) {
  const port = +(process.argv[2]) || 7749;
  createServer().listen(port, () => console.log(`HIVE running at http://localhost:${port}/`));
}

module.exports = { createServer };

// ── Embedded dashboard ────────────────────────────────────────────────────────

const HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>HIVE</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,sans-serif;background:#0d1117;color:#c9d1d9;min-height:100vh}
header{background:#161b22;border-bottom:1px solid #30363d;padding:12px 24px;display:flex;align-items:center;gap:16px}
h1{font-size:18px;color:#58a6ff}
#stats{font-size:13px;color:#8b949e;margin-left:auto}
nav{display:flex;gap:2px;padding:12px 24px 0;background:#0d1117}
nav button{background:none;border:none;border-bottom:2px solid transparent;color:#8b949e;padding:8px 16px;cursor:pointer;font-size:14px}
nav button.on{color:#58a6ff;border-bottom-color:#58a6ff}
.tab{display:none;padding:24px}
.tab.on{display:block}
input,select{background:#161b22;border:1px solid #30363d;color:#c9d1d9;padding:8px 12px;border-radius:6px;font-size:14px}
input{width:360px}
.row{display:flex;gap:8px;margin-bottom:16px;align-items:center;flex-wrap:wrap}
.btn{background:#21262d;border:1px solid #30363d;color:#c9d1d9;padding:8px 16px;border-radius:6px;cursor:pointer;font-size:14px}
.btn:hover{background:#30363d}
.card{background:#161b22;border:1px solid #21262d;border-radius:8px;padding:16px;margin-bottom:10px}
.ct{font-size:15px;font-weight:600;color:#e6edf3;margin-bottom:4px}
.cm{font-size:12px;color:#8b949e;margin-bottom:8px}
.cc{font-size:13px;white-space:pre-wrap;max-height:160px;overflow:hidden}
.b{display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;margin-right:4px}
.bt{background:#1f4b8e22;color:#58a6ff;border:1px solid #1f4b8e44}
.br{background:#1a7f3722;color:#3fb950;border:1px solid #1a7f3744}
.bi{background:#7d2f2f22;color:#f85149;border:1px solid #7d2f2f44}
.empty{color:#8b949e;padding:24px 0;font-size:14px}
.bar-row{display:flex;align-items:center;gap:10px;margin-bottom:6px}
.bar-label{width:180px;font-size:13px}
.bar{height:16px;background:#1f4b8e;border-radius:3px;min-width:2px}
.bar-count{font-size:12px;color:#8b949e}
#brief-out h1{font-size:20px;color:#e6edf3;margin:0 0 16px}
#brief-out h2{font-size:14px;color:#8b949e;text-transform:uppercase;margin:16px 0 8px}
#brief-out strong{color:#e6edf3}
#brief-out ul{padding-left:20px;margin:4px 0}
#brief-out li{margin-bottom:4px}
#brief-out p{margin-bottom:8px}
.modal{position:fixed;inset:0;background:#0009;display:none;align-items:center;justify-content:center;z-index:100}
.modal.on{display:flex}
.mbox{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:24px;width:480px;max-width:90vw}
.mbox h3{font-size:15px;color:#e6edf3;margin-bottom:16px}
.mbox label{display:block;font-size:12px;color:#8b949e;margin-bottom:4px}
.mbox .f{margin-bottom:12px}
.mbox textarea{background:#0d1117;border:1px solid #30363d;color:#c9d1d9;padding:8px 12px;border-radius:6px;font-size:13px;width:100%;resize:vertical}
.mbox input[type=number]{width:72px}
.mbtns{display:flex;gap:8px;justify-content:flex-end;margin-top:16px}
.merr{color:#f85149;font-size:12px;margin:4px 0 0}
.arch{background:none;border:none;color:#484f58;cursor:pointer;font-size:11px;float:right;padding:0}
.arch:hover{color:#f85149}
#gc{display:block;background:#0d1117;border-radius:8px;cursor:grab}
.legend{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}
.lk{display:flex;align-items:center;gap:5px;font-size:12px;color:#8b949e}
.lc{width:10px;height:10px;border-radius:50%;flex-shrink:0}
.cbar{display:inline-block;height:6px;border-radius:3px;vertical-align:middle;margin-left:4px}
</style></head>
<body>
<header><h1>&#x1F9E0; HIVE</h1><span id="stats">loading…</span><span style="margin-left:auto;display:flex;gap:8px"><a href="/api/export?format=json" download="hive-export.json" class="btn" style="text-decoration:none;font-size:12px">⬇ JSON</a><a href="/api/export?format=csv" download="hive-export.csv" class="btn" style="text-decoration:none;font-size:12px">⬇ CSV</a></span></header>
<nav>
  <button class="on" onclick="show('search',this)">Search</button>
  <button onclick="show('memories',this)">Memories</button>
  <button onclick="show('briefing',this)">Briefing</button>
  <button onclick="show('patterns',this)">Patterns</button>
  <button onclick="show('entities',this)">Entities</button>
  <button onclick="show('graph',this)">Graph</button>
  <button onclick="show('projects',this)">Projects</button>
  <button onclick="show('review',this)">Review</button>
  <button onclick="show('activity',this)">Activity</button>
  <button onclick="show('apikeys',this)">API Keys</button>
  <button onclick="show('webhooks',this)">Webhooks</button>
  <button onclick="show('tagcloud',this)">Tags</button>
  <button onclick="show('kstats',this)">Stats</button>
</nav>

<div id="search" class="tab on">
  <div class="row">
    <input id="q" placeholder="Search memories…" onkeydown="if(event.key==='Enter')doSearch()" list="q-history" autocomplete="off">
    <datalist id="q-history"></datalist>
    <select id="smode" title="Search mode"><option value="keyword">Keyword</option><option value="hybrid">Hybrid</option><option value="semantic">Semantic</option></select>
    <button class="btn" onclick="doSearch()">Search</button>
  </div>
  <div id="sr"></div>
</div>

<div id="memories" class="tab">
  <div class="row">
    <select id="mtype" onchange="loadMem()"><option value="">All types</option><option>core</option><option>domain</option><option>project</option><option>episodic</option><option>semantic</option><option>skill</option></select>
    <select id="mtrust" onchange="loadMem()"><option value="">All trust</option><option>USER_CONFIRMED</option><option>SOURCE_VERIFIED</option><option>OBSERVED</option><option>INFERRED</option></select>
    <select id="mproj" onchange="loadMem()"><option value="">All projects</option></select>
    <select id="mtag" onchange="loadMem()"><option value="">All tags</option></select>
    <select id="mconf" onchange="loadMem()" title="Min confidence"><option value="">Any confidence</option><option value="0.8">≥ 0.8 (high)</option><option value="0.6">≥ 0.6 (medium+)</option><option value="0.0" data-max="0.4">≤ 0.4 (low)</option></select>
    <button class="btn" onclick="showAdd()" style="margin-left:auto">+ Add Memory</button>
  </div>
  <div id="bulk-bar" style="display:none;padding:8px 0;display:none;gap:10px;align-items:center;border-bottom:1px solid #30363d;margin-bottom:8px">
    <span id="bulk-count" style="color:#8b949e;font-size:13px"></span>
    <button class="btn" onclick="bulkArchive()">Archive selected</button>
    <select id="bulk-type" style="background:#161b22;color:#c9d1d9;border:1px solid #30363d;border-radius:6px;padding:4px 8px">
      <option value="">Change type…</option><option>core</option><option>domain</option><option>project</option><option>episodic</option><option>semantic</option><option>skill</option>
    </select>
    <button class="btn" onclick="bulkRetype()">Apply type</button>
    <button class="arch" onclick="clearSelection()" style="margin-left:auto">✕ clear</button>
  </div>
  <div id="ml"></div>
</div>

<div id="briefing" class="tab">
  <div class="row"><button class="btn" onclick="loadBrief()">Load Briefing</button></div>
  <div id="brief-out"><p class="empty">Click "Load Briefing" to generate.</p></div>
</div>

<div id="patterns" class="tab"><div id="pc"></div></div>
<div id="entities" class="tab"><div id="el"></div></div>
<div id="graph" class="tab">
  <div class="row" style="margin-bottom:12px;gap:8px">
    <input id="g-search" placeholder="Filter by name…" style="width:200px" oninput="loadGraph()">
    <select id="g-type" onchange="loadGraph()"><option value="">All types</option><option>person</option><option>tool</option><option>org</option><option>concept</option><option>project</option><option>file</option><option>domain</option><option>other</option></select>
    <button class="btn" onclick="loadGraph()">↺ Refresh</button>
    <button class="btn" onclick="fitGraph()">⤢ Fit</button>
    <span id="g-count" style="font-size:12px;color:#8b949e;margin-left:4px"></span>
  </div>
  <div id="gleg" class="legend"></div>
  <div style="position:relative">
    <canvas id="gc"></canvas>
    <div id="g-tip" style="display:none;position:absolute;background:#161b22;border:1px solid #30363d;border-radius:6px;padding:8px 12px;font-size:12px;pointer-events:none;white-space:nowrap;z-index:10"></div>
  </div>
  <div id="g-info" style="display:none;padding:12px;background:#161b22;border:1px solid #21262d;border-radius:6px;margin-top:8px;font-size:13px"></div>
  <p id="gmt" class="empty" style="display:none">No entities yet — add some via the CLI or the Memories tab.</p>
</div>

<div id="projects" class="tab"><div id="pl"><p class="empty">Loading…</p></div></div>
<div id="activity" class="tab"><div id="al"><p class="empty">Loading…</p></div></div>
<div id="review" class="tab"><div class="row"><button class="btn" onclick="loadReview()">Load Review Digest</button></div><div id="rv"><p class="empty">Click "Load Review Digest" to see memories due for review.</p></div></div>

<div id="apikeys" class="tab">
  <div class="row" style="margin-bottom:16px">
    <input id="ak-name" placeholder="Key name (e.g. obsidian)" style="width:220px">
    <button class="btn" onclick="createKey()">Generate Key</button>
  </div>
  <div id="ak-new" style="display:none;padding:12px;background:#0d1117;border:1px solid #238636;border-radius:6px;margin-bottom:16px;font-family:monospace;font-size:13px;color:#3fb950">
    <strong>Copy this key — it will not be shown again:</strong><br>
    <span id="ak-val"></span>
    <button class="btn" style="margin-left:12px;font-size:11px;padding:4px 8px" onclick="copyKey()">Copy</button>
  </div>
  <div id="akl"><p class="empty">Loading keys…</p></div>
</div>

<div id="webhooks" class="tab">
  <div class="row" style="margin-bottom:16px;gap:8px">
    <input id="wh-url" placeholder="https://example.com/hook" style="width:300px">
    <input id="wh-events" placeholder="Events (comma-sep, * = all)" style="width:220px" value="*">
    <button class="btn" onclick="addWebhook()">Register</button>
  </div>
  <div id="whl"><p class="empty">Loading webhooks…</p></div>
</div>

<div id="kstats" class="tab">
  <div class="row" style="margin-bottom:16px"><button class="btn" onclick="loadKStats()">↺ Refresh</button></div>
  <div id="ks-body"><p class="empty">Click Refresh to load stats.</p></div>
</div>

<div id="tagcloud" class="tab">
  <div class="row" style="margin-bottom:12px;gap:8px">
    <button class="btn" onclick="loadTagCloud()">↺ Refresh</button>
    <input id="tc-co" placeholder="Co-occurrence for tag…" style="width:200px" oninput="loadCoOccurrence()">
  </div>
  <div id="tc-cloud" style="line-height:2.4;padding:8px 0"></div>
  <div id="tc-top" style="margin-top:16px"></div>
  <div id="tc-co-out" style="margin-top:16px;display:none">
    <h4 style="margin:0 0 8px;font-size:13px;color:#8b949e">Co-occurring tags</h4>
    <div id="tc-co-list"></div>
  </div>
</div>

<div id="hist-modal" class="modal" onclick="if(event.target===this)this.style.display='none'">
  <div class="mbox" style="max-width:700px;max-height:85vh;overflow-y:auto">
    <h3>Version History</h3>
    <div id="hist-list"></div>
    <div id="hist-diff" style="display:none;margin-top:12px">
      <h4 style="margin:0 0 8px;font-size:13px;color:#8b949e">Diff vs current (snapshot → current)</h4>
      <pre id="hist-diff-out" style="font-size:12px;line-height:1.6;white-space:pre-wrap;background:#0d1117;padding:12px;border-radius:6px;border:1px solid #21262d;overflow-x:auto"></pre>
    </div>
    <div class="mbtns"><button class="btn" onclick="g('hist-modal').style.display='none'">Close</button></div>
  </div>
</div>

<div id="add-modal" class="modal">
  <div class="mbox">
    <h3 id="nm-h">Add Memory</h3>
    <div class="f"><label>Title *</label><input id="nm-t" style="width:100%" placeholder="Memory title"></div>
    <div class="f"><label>Content *</label><textarea id="nm-c" rows="5" placeholder="Memory content…"></textarea></div>
    <div class="f"><label>Type</label><select id="nm-ty" onchange="applyTemplate(this.value)"><option>semantic</option><option>core</option><option>domain</option><option>project</option><option>episodic</option><option>skill</option></select></div>
    <div class="f"><label>Trust</label><select id="nm-tr"><option>OBSERVED</option><option>USER_CONFIRMED</option><option>SOURCE_VERIFIED</option><option>INFERRED</option></select></div>
    <div class="f"><label>Importance (1–10)</label><input id="nm-i" type="number" min="1" max="10" value="5"></div>
    <div class="f"><label>Confidence (0–1) <span style="font-weight:normal;color:#8b949e">how certain this is</span></label><input id="nm-cf" type="number" min="0" max="1" step="0.05" value="0.5" style="width:88px"></div>
    <div class="f"><label>Tags <span style="font-weight:normal;color:#8b949e">(comma-separated)</span></label><input id="nm-tg" style="width:100%" placeholder="e.g. javascript, async, todo"></div>
    <p id="nm-err" class="merr"></p>
    <div id="nm-dup" style="display:none;margin:8px 0;padding:10px;background:#2d1f0a;border:1px solid #d2a8ff44;border-radius:6px;font-size:12px">
      <strong style="color:#d2a8ff">⚠ Similar memories found:</strong>
      <div id="nm-dup-list" style="margin-top:6px;color:#8b949e"></div>
      <div style="margin-top:8px;display:flex;gap:8px">
        <button class="btn" style="font-size:12px;padding:4px 10px" onclick="saveAnyway()">Save anyway</button>
        <button class="btn" style="font-size:12px;padding:4px 10px" onclick="g('nm-dup').style.display='none'">Review first</button>
      </div>
    </div>
    <div class="mbtns">
      <button class="btn" onclick="closeAdd()">Cancel</button>
      <button class="btn" onclick="submitAdd()">Save</button>
    </div>
  </div>
</div>

<script>
const g = id => document.getElementById(id);
const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const api = u => fetch(u).then(r => r.json());

function show(id, btn) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('on'));
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('on'));
  g(id).classList.add('on'); btn.classList.add('on');
  if (id==='patterns') loadPat();
  if (id==='entities') loadEnt();
  if (id==='memories') loadMem();
  if (id==='graph') loadGraph();
  if (id==='projects') loadProjects();
  if (id==='review') loadReview();
  if (id==='activity') loadActivity();
  if (id==='apikeys') loadKeys();
  if (id==='webhooks') loadWebhooks();
  if (id==='tagcloud') loadTagCloud();
  if (id==='kstats') loadKStats();
}

function confBar(c) {
  const pct = Math.round((c||0.5)*100);
  const col = c >= 0.8 ? '#3fb950' : c >= 0.5 ? '#d29922' : '#f85149';
  return \`<span title="confidence \${pct}%" style="font-size:11px;color:\${col};margin-right:4px">▸\${pct}%<span class="cbar" style="width:\${pct/2}px;background:\${col}"></span></span>\`;
}
function card(m) {
  const preview = (m.content||'').replace(/\\n/g,' ').slice(0,280);
  const tags = (m.tags||[]).map(t=>\`<span class="b" style="cursor:pointer;color:#79c0ff" onclick="filterTag('\${esc(t)}')">#\${esc(t)}</span>\`).join(' ');
  return \`<div class="card" data-id="\${m.id}">
    <div class="ct"><input type="checkbox" style="margin-right:8px;cursor:pointer" onchange="toggleSel('\${m.id}',this.checked)">\${esc(m.title)}<button class="arch" onclick="archiveMem('\${m.id}',this)" title="Archive">× archive</button><button class="arch" onclick="showEdit('\${m.id}')" title="Edit">✎ edit</button><button class="arch" onclick="showHistory('\${m.id}')" title="History">⏱ history</button></div>
    <div class="cm">\${confBar(m.confidence)}<span class="b bt">\${m.memory_type}</span><span class="b br">\${m.trust_level}</span><span class="b bi">i=\${m.importance}</span>\${tags}</div>
    <div class="cc">\${esc(preview)}\${m.content.length>280?'…':''}</div>
  </div>\`;
}

async function doSearch() {
  const q = g('q').value.trim();
  if (!q) return;
  const mode = g('smode').value;
  const d = await api('/api/search?q='+encodeURIComponent(q)+'&limit=20&mode='+mode);
  g('sr').innerHTML = d.length ? d.map(card).join('') : '<p class="empty">No results.</p>';
  loadHistory();
}

let _sel = new Set();
function toggleSel(id, on) {
  on ? _sel.add(id) : _sel.delete(id);
  const bar = g('bulk-bar');
  if (_sel.size) { bar.style.display='flex'; g('bulk-count').textContent=_sel.size+' selected'; }
  else { bar.style.display='none'; }
}
function clearSelection() {
  _sel.clear();
  g('bulk-bar').style.display='none';
  document.querySelectorAll('#ml input[type=checkbox]').forEach(cb => cb.checked=false);
}
async function bulkArchive() {
  if (!_sel.size) return;
  const r = await fetch('/api/memories/bulk',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:[..._sel],action:'archive'})});
  const d = await r.json();
  _sel.clear(); loadMem(); refreshStats();
  g('bulk-bar').style.display='none';
}
async function bulkRetype() {
  const ty = g('bulk-type').value;
  if (!ty || !_sel.size) return;
  await fetch('/api/memories/bulk',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:[..._sel],action:'update',updates:{memory_type:ty}})});
  _sel.clear(); loadMem();
  g('bulk-bar').style.display='none'; g('bulk-type').value='';
}

async function loadMem() {
  _sel.clear(); g('bulk-bar').style.display='none';
  let u = '/api/memories?limit=50';
  const t=g('mtype').value, r=g('mtrust').value, p=g('mproj').value, tg=g('mtag').value;
  const confOpt = g('mconf').selectedOptions[0];
  const minC = confOpt ? confOpt.value : '';
  const maxC = confOpt ? (confOpt.dataset.max||'') : '';
  if (t) u += '&type='+t; if (r) u += '&trust='+r; if (p) u += '&project='+p; if (tg) u += '&tag='+encodeURIComponent(tg);
  if (minC !== '') u += '&min_conf='+minC; if (maxC !== '') u += '&max_conf='+maxC;
  const d = await api(u);
  g('ml').innerHTML = d.length ? d.map(card).join('') : '<p class="empty">No memories.</p>';
}

async function loadBrief() {
  const d = await api('/api/brief');
  const t = (d.text||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/^# (.+)$/gm,'<h1>$1</h1>').replace(/^## (.+)$/gm,'<h2>$1</h2>')
    .replace(/\\*\\*(.+?)\\*\\*/g,'<strong>$1</strong>').replace(/^- (.+)$/gm,'<li>$1</li>')
    .replace(/\\*([^*]+)\\*/g,'<em>$1</em>').replace(/\\n\\n/g,'<br>');
  g('brief-out').innerHTML = t || '<p class="empty">No briefing available.</p>';
}

async function loadProjects() {
  const ps = await api('/api/projects');
  if (!ps.length) { g('pl').innerHTML='<p class="empty">No projects yet — create one with <code>hive project create</code>.</p>'; return; }
  const cards = await Promise.all(ps.map(async p => {
    let mc=0, ec=0;
    try { const s=await api('/api/projects/'+p.id+'/stats'); mc=s.memory_count||0; ec=s.entity_count||0; } catch {}
    return \`<div class="card"><div class="ct">\${esc(p.name)}<button class="arch" onclick="viewProject('\${p.id}')" title="View memories">→ memories</button></div>
    <div class="cm"><span class="b bt">\${p.domain||'—'}</span><span class="b bi">\${mc} memories</span><span class="b br">\${ec} entities</span></div>
    \${p.objective?'<div class="cc">'+esc(p.objective.slice(0,180))+'</div>':''}</div>\`;
  }));
  g('pl').innerHTML = cards.join('');
}
function viewProject(id) {
  const sel = g('mproj');
  if (sel) { sel.value = id; }
  document.querySelectorAll('nav button').forEach(b => { if (b.textContent==='Memories') b.click(); });
}

async function loadReview() {
  const d = await api('/api/review?limit=30');
  if (!d.length) { g('rv').innerHTML='<p class="empty">Nothing to review — all memories are fresh!</p>'; return; }
  const U = {critical:'#f85149', warning:'#d29922', ok:'#3fb950'};
  const rows = d.map(m => {
    const col = U[m.urgency]||'#8b949e';
    return \`<div class="card" data-id="\${m.id}">
      <div class="ct" style="border-left:3px solid \${col};padding-left:8px">\${esc(m.title)}
        <button class="arch" onclick="archiveMem('\${m.id}',this)">× archive</button>
        <button class="arch" onclick="reinforceMem('\${m.id}',this)">↑ reinforce</button>
      </div>
      <div class="cm"><span class="b bi">\${m.days_idle}d idle</span><span class="b bt">\${m.memory_type}</span><span class="b" style="color:\${col}">\${m.urgency}</span></div>
      <div class="cc">\${esc((m.content||'').slice(0,180))}</div>
    </div>\`;
  });
  g('rv').innerHTML = rows.join('');
}

async function reinforceMem(id, btn) {
  await fetch('/api/memories/'+id+'/reinforce', {method:'POST'});
  btn.textContent='✓';
  btn.disabled=true;
}

async function loadActivity() {
  const d = await api('/api/activity?limit=50');
  if (!d.length) { g('al').innerHTML='<p class="empty">No activity yet.</p>'; return; }
  const ICONS = {CREATE:'✚',UPDATE:'✎',DELETE:'✕',REINFORCE:'↑',default:'·'};
  const rows = d.map(e => {
    const icon = ICONS[e.action] || ICONS.default;
    const label = e.title ? \`<strong>\${esc(e.title)}</strong>\` : esc(e.entity_type+':'+e.entity_id.slice(0,8));
    return \`<div class="card" style="display:flex;gap:12px;align-items:flex-start">
      <span style="font-size:18px;min-width:24px;text-align:center">\${icon}</span>
      <div style="flex:1"><div>\${label}</div>
      <div class="cm"><span class="b bt">\${e.action}</span><span class="b br">\${e.entity_type}</span><span style="color:#8b949e;font-size:11px">\${e.time_ago}</span></div></div>
    </div>\`;
  });
  g('al').innerHTML = rows.join('');
}

async function loadPat() {
  const d = await api('/api/patterns?days=30&limit=20');
  if (!d.length) { g('pc').innerHTML='<p class="empty">No patterns yet.</p>'; return; }
  const max = d[0].count;
  g('pc').innerHTML = d.map(x=>\`<div class="bar-row"><div class="bar-label">\${esc(x.word)}</div><div class="bar" style="width:\${Math.round(x.count/max*300)}px"></div><div class="bar-count">\${x.count}</div></div>\`).join('');
}

async function loadEnt() {
  const d = await api('/api/entities?limit=100');
  if (!d.length) { g('el').innerHTML='<p class="empty">No entities yet.</p>'; return; }
  g('el').innerHTML = d.map(e=>\`<div class="card"><div class="ct">\${esc(e.name)}</div><div class="cm"><span class="b bt">\${e.entity_type}</span>\${e.aliases.length?' · '+e.aliases.join(', '):''}</div>\${e.description?\`<div class="cc">\${esc(e.description)}</div>\`:''}</div>\`).join('');
}

let gStop = null, gNodes = [], gOffset = {x:0,y:0}, gScale = 1;
function fitGraph() {
  if (!gNodes.length) return;
  const xs = gNodes.map(n=>n.x), ys = gNodes.map(n=>n.y);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  const gc = g('gc');
  const W=gc.width, H=gc.height;
  const pad=40, sw=(W-pad*2)/(maxX-minX||1), sh=(H-pad*2)/(maxY-minY||1);
  gScale=Math.min(sw,sh,.95);
  gOffset.x=W/2-((minX+maxX)/2)*gScale;
  gOffset.y=H/2-((minY+maxY)/2)*gScale;
}
async function loadGraph() {
  if (gStop) { gStop(); gStop = null; }
  let url = '/api/graph?limit=120';
  const sr=g('g-search').value.trim(), ty=g('g-type').value;
  if (sr) url += '&search='+encodeURIComponent(sr);
  if (ty) url += '&type='+ty;
  const data = await api(url);
  const gc = g('gc'), gmt = g('gmt'), tip = g('g-tip'), info = g('g-info');
  if (!data.nodes.length) { gmt.style.display='block'; gc.style.display='none'; info.style.display='none'; g('g-count').textContent=''; return; }
  gmt.style.display='none'; gc.style.display='block';
  g('g-count').textContent = data.nodes.length+' nodes · '+data.edges.length+' edges';
  const C = {person:'#58a6ff',tool:'#3fb950',org:'#d2a8ff',concept:'#f0883e',project:'#79c0ff',file:'#ffa657',domain:'#ff7b72',other:'#8b949e'};
  const types = [...new Set(data.nodes.map(n=>n.entity_type))];
  g('gleg').innerHTML = types.map(t=>'<div class="lk"><div class="lc" style="background:'+(C[t]||'#8b949e')+'"></div>'+esc(t)+'</div>').join('');
  const W = gc.width = gc.parentElement.clientWidth - 2 || 800;
  const H = gc.height = 520;
  const ctx = gc.getContext('2d');
  gScale=1; gOffset={x:0,y:0};
  const ns = data.nodes.map(n=>({...n,x:W/2+(Math.random()-.5)*300,y:H/2+(Math.random()-.5)*300,vx:0,vy:0,r:8+Math.min((n.degree||0)*2,10)}));
  gNodes = ns;
  const nm = {}; ns.forEach(n=>{nm[n.id]=n;});
  const es = data.edges.filter(e=>nm[e.from_id]&&nm[e.to_id]);
  let drag=null, selId=null;
  const neighOf = id => new Set(es.flatMap(e=>e.from_id===id?[e.to_id]:e.to_id===id?[e.from_id]:[]));

  function toWorld(cx,cy){return{x:(cx-gOffset.x)/gScale,y:(cy-gOffset.y)/gScale};}
  function hitNode(wx,wy){return ns.find(n=>Math.hypot(n.x-wx,n.y-wy)<n.r+4)||null;}

  gc.onwheel=e=>{e.preventDefault();const f=e.deltaY<0?1.1:.91;const r=gc.getBoundingClientRect(),cx=e.clientX-r.left,cy=e.clientY-r.top;gOffset.x=cx-(cx-gOffset.x)*f;gOffset.y=cy-(cy-gOffset.y)*f;gScale*=f;};
  gc.onmousedown=e=>{
    const r=gc.getBoundingClientRect(),{x,y}=toWorld(e.clientX-r.left,e.clientY-r.top);
    drag=hitNode(x,y);
    if(drag){drag.fixed=true;}
  };
  gc.onmousemove=e=>{
    const r=gc.getBoundingClientRect(),cx=e.clientX-r.left,cy=e.clientY-r.top,{x,y}=toWorld(cx,cy);
    if(drag){drag.x=x;drag.y=y;return;}
    const hn=hitNode(x,y);
    if(hn){
      tip.style.display='block';tip.style.left=(cx+12)+'px';tip.style.top=(cy-8)+'px';
      tip.textContent=hn.name+' ['+hn.entity_type+'] · '+hn.degree+' connection'+(hn.degree===1?'':'s');
      gc.style.cursor='pointer';
    } else {tip.style.display='none';gc.style.cursor='default';}
  };
  gc.onmouseup=e=>{
    if(drag){
      const r=gc.getBoundingClientRect(),{x,y}=toWorld(e.clientX-r.left,e.clientY-r.top);
      if(Math.hypot(drag.x-x,drag.y-y)<4){
        selId=selId===drag.id?null:drag.id;
        if(selId){
          const nb=neighOf(selId);
          const edgesOut=es.filter(e=>e.from_id===selId||e.to_id===selId);
          info.style.display='block';
          info.innerHTML='<strong style="color:#e6edf3">'+esc(drag.name)+'</strong> <span style="color:#8b949e">['+drag.entity_type+']</span> · '+drag.degree+' connection'+(drag.degree===1?'':'s')+
            (edgesOut.length?'<br><span style="color:#8b949e;font-size:11px">→ '+edgesOut.map(e=>{const o=nm[e.from_id===selId?e.to_id:e.from_id];return'<b>'+esc(e.rel_type)+'</b> '+esc(o.name);}).join(' &nbsp;·&nbsp; ')+'</span>':'');
        } else { info.style.display='none'; }
      }
      drag.fixed=false; drag=null;
    }
  };
  gc.onmouseleave=()=>{tip.style.display='none';};

  let raf, t=0;
  function tick(){
    t++;
    const cool=Math.max(.3,1-t/300);
    for(let i=0;i<ns.length;i++)for(let j=i+1;j<ns.length;j++){
      const a=ns[i],b=ns[j],dx=b.x-a.x,dy=b.y-a.y,d=Math.sqrt(dx*dx+dy*dy)||1;
      const f=4000/(d*d)*cool;
      a.vx-=dx/d*f;a.vy-=dy/d*f;b.vx+=dx/d*f;b.vy+=dy/d*f;
    }
    for(const e of es){
      const a=nm[e.from_id],b=nm[e.to_id],dx=b.x-a.x,dy=b.y-a.y,d=Math.sqrt(dx*dx+dy*dy)||1;
      const ideal=100+(a.r+b.r),f=(d-ideal)*.04;
      a.vx+=dx/d*f;a.vy+=dy/d*f;b.vx-=dx/d*f;b.vy-=dy/d*f;
    }
    const cx=W/2,cy=H/2;
    for(const n of ns){n.vx+=(cx-n.x)*.001;n.vy+=(cy-n.y)*.001;}
    for(const n of ns){if(n.fixed)continue;n.vx*=.82;n.vy*=.82;n.x+=n.vx;n.y+=n.vy;}

    const nb=selId?neighOf(selId):null;
    ctx.clearRect(0,0,W,H);
    ctx.save();ctx.translate(gOffset.x,gOffset.y);ctx.scale(gScale,gScale);

    // edges
    for(const e of es){
      const a=nm[e.from_id],b=nm[e.to_id];
      const dim=selId&&!nb.has(e.from_id)&&!nb.has(e.to_id)&&e.from_id!==selId&&e.to_id!==selId;
      ctx.globalAlpha=dim?.12:.7;
      ctx.strokeStyle=selId&&(e.from_id===selId||e.to_id===selId)?'#58a6ff':'#30363d';
      ctx.lineWidth=(selId&&(e.from_id===selId||e.to_id===selId)?2:1)/gScale;
      ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
      // edge label at midpoint
      if(gScale>.7){
        ctx.globalAlpha=dim?.08:.45;ctx.fillStyle='#8b949e';ctx.font=(10/gScale)+'px sans-serif';ctx.textAlign='center';
        ctx.fillText(e.rel_type,(a.x+b.x)/2,(a.y+b.y)/2-4/gScale);
      }
    }
    // nodes
    for(const n of ns){
      const dim=selId&&n.id!==selId&&!nb.has(n.id);
      ctx.globalAlpha=dim?.2:1;
      ctx.fillStyle=n.id===selId?'#fff':(C[n.entity_type]||'#8b949e');
      ctx.beginPath();ctx.arc(n.x,n.y,n.r,0,Math.PI*2);ctx.fill();
      ctx.globalAlpha=dim?.1:.85;
      ctx.fillStyle='#c9d1d9';ctx.font=(11/gScale)+'px sans-serif';ctx.textAlign='center';
      const lbl=n.name.length>20?n.name.slice(0,19)+'…':n.name;
      ctx.fillText(lbl,n.x,n.y+n.r+13/gScale);
    }
    ctx.restore();ctx.globalAlpha=1;
    raf=requestAnimationFrame(tick);
  }
  tick();
  gStop=()=>cancelAnimationFrame(raf);
}

function refreshStats() { api('/api/stats').then(d => g('stats').textContent = \`\${d.memories} memories · \${d.entities} entities · \${d.projects} projects\`); }
let _editId = null;
let _tplCache = null;
async function _loadTemplates() {
  if (!_tplCache) _tplCache = await api('/api/templates').then(a => Object.fromEntries(a.map(t=>[t.memory_type,t])));
  return _tplCache;
}
async function applyTemplate(type) {
  if (_editId) return; // don't clobber an edit
  const tpls = await _loadTemplates();
  const tpl = tpls[type]; if (!tpl) return;
  if (tpl.title_hint && !g('nm-t').value) g('nm-t').placeholder = tpl.title_hint + '…';
  else if (!tpl.title_hint) g('nm-t').placeholder = 'Memory title';
  if (!g('nm-c').value && tpl.content_hint) g('nm-c').value = tpl.content_hint;
  g('nm-tr').value = tpl.trust_level;
  g('nm-i').value  = tpl.importance;
  g('nm-cf').value = tpl.confidence;
  if (tpl.tags.length && !g('nm-tg').value) g('nm-tg').value = tpl.tags.join(', ');
}
function showAdd() { _editId=null; g('nm-h').textContent='Add Memory'; g('nm-t').value=''; g('nm-c').value=''; g('nm-ty').value='semantic'; g('nm-tr').value='OBSERVED'; g('nm-i').value='5'; g('nm-cf').value='0.5'; g('nm-tg').value=''; g('nm-err').textContent=''; g('add-modal').classList.add('on'); }
async function showEdit(id) { const d=await api('/api/memories/'+id); _editId=id; g('nm-h').textContent='Edit Memory'; g('nm-t').value=d.title||''; g('nm-c').value=d.content||''; g('nm-ty').value=d.memory_type||'semantic'; g('nm-tr').value=d.trust_level||'OBSERVED'; g('nm-i').value=d.importance||5; g('nm-cf').value=d.confidence!=null?d.confidence:0.5; g('nm-tg').value=(d.tags||[]).join(', '); g('nm-err').textContent=''; g('add-modal').classList.add('on'); }
function closeAdd() { g('add-modal').classList.remove('on'); g('nm-dup').style.display='none'; }
function _buildPayload() {
  const rawTags = g('nm-tg').value.split(',').map(t=>t.trim()).filter(Boolean);
  return { title: g('nm-t').value.trim(), content: g('nm-c').value.trim(), memory_type: g('nm-ty').value, trust_level: g('nm-tr').value, importance: +g('nm-i').value, confidence: +g('nm-cf').value, tags: rawTags };
}
async function _doSave(payload) {
  const r = _editId
    ? await fetch('/api/memories/'+_editId, { method:'PUT',  headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) })
    : await fetch('/api/memories',           { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
  if (!r.ok) { const e = await r.json(); g('nm-err').textContent = e.error || 'Save failed.'; return false; }
  closeAdd(); loadMem(); refreshStats(); loadTagSelect(); return true;
}
async function saveAnyway() { await _doSave(_buildPayload()); }
async function submitAdd() {
  const payload = _buildPayload();
  if (!payload.title || !payload.content) { g('nm-err').textContent = 'Title and content are required.'; return; }
  g('nm-err').textContent = ''; g('nm-dup').style.display='none';
  // Only check duplicates on new memories, not edits
  if (!_editId) {
    const dups = await fetch('/api/memories/similar?title='+encodeURIComponent(payload.title)+'&content='+encodeURIComponent(payload.content.slice(0,500))).then(r=>r.json());
    if (dups.length) {
      g('nm-dup-list').innerHTML = dups.map(d=>\`<div>· <strong>\${esc(d.title)}</strong> <span style="color:#d2a8ff">\${Math.round(d.score*100)}% similar</span></div>\`).join('');
      g('nm-dup').style.display='block'; return;
    }
  }
  await _doSave(payload);
}
async function archiveMem(id, btn) {
  btn.textContent = '…';
  const r = await fetch(\`/api/memories/\${id}\`, { method:'DELETE' });
  if (r.ok) { btn.closest('.card').remove(); refreshStats(); }
  else btn.textContent = '× archive';
}
function filterTag(tag) { const sel=g('mtag'); sel.value=tag; document.querySelectorAll('nav button').forEach(b=>{if(b.textContent==='Memories')b.click();}); }
function loadTagSelect() { api('/api/tags').then(ts => { const sel=g('mtag'); sel.innerHTML='<option value="">All tags</option>'; ts.forEach(({tag,count})=>{const o=document.createElement('option');o.value=tag;o.textContent=tag+' ('+count+')';sel.appendChild(o);}); }); }
refreshStats();
api('/api/projects').then(ps => { const sel=g('mproj'); ps.forEach(p=>{const o=document.createElement('option');o.value=p.id;o.textContent=p.name;sel.appendChild(o);}); });
loadTagSelect();
function loadHistory() { api('/api/search/history?limit=30').then(hs => { const dl=g('q-history'); dl.innerHTML=''; hs.forEach(h=>{const o=document.createElement('option');o.value=h.query;dl.appendChild(o);}); }); }
loadHistory();

function localFetch(url, opts={}) {
  opts.headers = Object.assign({'X-Hive-Local':'1'}, opts.headers||{});
  return fetch(url, opts);
}
async function loadKeys() {
  const ks = await localFetch('/api/apikeys').then(r=>r.json());
  const el = g('akl');
  if (!ks.length) { el.innerHTML='<p class="empty">No API keys yet. Generate one above.</p>'; return; }
  const fmt = ts => ts ? new Date(ts).toLocaleString() : 'never';
  el.innerHTML = ks.map(k=>\`<div class="card" style="display:flex;align-items:center;gap:12px">
    <span style="flex:1;font-weight:600;color:#e6edf3">\${esc(k.name)}</span>
    <span style="font-size:12px;color:#8b949e">created \${fmt(k.created_at)}</span>
    <span style="font-size:12px;color:#8b949e">last used \${fmt(k.last_used_at)}</span>
    <button class="btn" style="font-size:12px;padding:4px 10px;color:#f85149" onclick="revokeKey('\${esc(k.name)}')">Revoke</button>
  </div>\`).join('');
}
async function createKey() {
  const name = g('ak-name').value.trim();
  if (!name) return;
  const r = await localFetch('/api/apikeys',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})});
  const d = await r.json();
  if (d.error) { alert(d.error); return; }
  g('ak-val').textContent = d.key;
  g('ak-new').style.display='block';
  g('ak-name').value='';
  loadKeys();
}
function copyKey() { navigator.clipboard.writeText(g('ak-val').textContent); }
async function revokeKey(name) {
  if (!confirm(\`Revoke key "\${name}"?\`)) return;
  await localFetch('/api/apikeys/'+encodeURIComponent(name),{method:'DELETE',headers:{'X-Hive-Local':'1'}});
  loadKeys();
}
async function loadWebhooks() {
  const ws = await localFetch('/api/webhooks').then(r=>r.json());
  const el = g('whl');
  if (!ws.length) { el.innerHTML='<p class="empty">No webhooks registered yet.</p>'; return; }
  const fmt = ts => ts ? new Date(ts).toLocaleString() : '—';
  el.innerHTML = ws.map(w=>\`<div class="card" style="display:flex;align-items:center;gap:12px">
    <div style="flex:1;min-width:0">
      <div style="font-family:monospace;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">\${w.url}</div>
      <div style="font-size:11px;color:#8b949e;margin-top:4px">Events: \${Array.isArray(w.events)?w.events.join(', '):w.events} &nbsp;·&nbsp; Last fired: \${fmt(w.last_triggered_at)} &nbsp;·&nbsp; Status: \${w.last_status||'—'}</div>
    </div>
    <button class="arch" onclick="deleteWebhook(\${w.id})">Delete</button>
  </div>\`).join('');
}
async function addWebhook() {
  const url = g('wh-url').value.trim();
  if (!url) return;
  const evRaw = g('wh-events').value.trim();
  const events = evRaw ? evRaw.split(',').map(e=>e.trim()).filter(Boolean) : ['*'];
  const r = await localFetch('/api/webhooks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url,events})});
  const d = await r.json();
  if (d.error) { alert(d.error); return; }
  g('wh-url').value=''; g('wh-events').value='*';
  loadWebhooks();
}
async function deleteWebhook(id) {
  if (!confirm('Delete this webhook?')) return;
  await localFetch('/api/webhooks/'+id,{method:'DELETE'});
  loadWebhooks();
}
async function showHistory(memId) {
  g('hist-diff').style.display='none';
  g('hist-list').innerHTML='<p class="empty">Loading…</p>';
  g('hist-modal').style.display='flex';
  const vs = await api('/api/memories/'+memId+'/versions');
  if (!vs.length) { g('hist-list').innerHTML='<p class="empty">No prior versions — history is recorded after each edit.</p>'; return; }
  const fmt = ts => new Date(ts).toLocaleString();
  g('hist-list').innerHTML = vs.map(v=>\`<div class="card" style="display:flex;align-items:center;gap:10px;padding:8px 12px">
    <div style="flex:1"><div style="font-size:13px">\${esc(v.title)}</div><div style="font-size:11px;color:#8b949e">\${fmt(v.snapshot_at)}</div></div>
    <button class="btn" style="font-size:11px;padding:3px 8px" onclick="showDiff(\${v.id})">View diff</button>
  </div>\`).join('');
}
async function loadKStats() {
  const d = await api('/api/stats/full');
  const bar = (count, max, col) => {
    const w = max ? Math.round((count/max)*180) : 0;
    return \`<span style="display:inline-block;height:12px;width:\${w}px;background:\${col};border-radius:2px;vertical-align:middle;margin-right:6px"></span>\`;
  };
  const section = (title, rows, col) => {
    if (!rows.length) return '';
    const max = rows[0].count;
    return \`<div style="margin-bottom:20px"><h4 style="margin:0 0 8px;font-size:12px;color:#8b949e;text-transform:uppercase;letter-spacing:.05em">\${title}</h4>
      \${rows.map(r=>\`<div style="margin:4px 0;font-size:13px">\${bar(r.count,max,col)}<span style="color:#c9d1d9">\${esc(r.label)}</span><span style="color:#8b949e;margin-left:6px">\${r.count}</span></div>\`).join('')}
    </div>\`;
  };
  // Sparkline canvas
  const sparkId = 'ks-spark-'+Date.now();
  const maxG = Math.max(...d.growth.map(g=>g.count), 1);
  const html = \`
    <div style="display:flex;gap:24px;flex-wrap:wrap;margin-bottom:20px">
      \${[['Memories',d.total,'#58a6ff'],['Archived',d.archived,'#8b949e'],['Entities',d.entities,'#d2a8ff'],['Projects',d.projects,'#3fb950']].map(([l,v,c])=>\`
        <div style="text-align:center;min-width:80px"><div style="font-size:28px;font-weight:700;color:\${c}">\${v}</div><div style="font-size:11px;color:#8b949e;margin-top:2px">\${l}</div></div>
      \`).join('')}
      <div style="text-align:center;min-width:80px"><div style="font-size:28px;font-weight:700;color:#ffa657">\${d.avgConf}</div><div style="font-size:11px;color:#8b949e;margin-top:2px">Avg confidence</div></div>
      <div style="text-align:center;min-width:80px"><div style="font-size:28px;font-weight:700;color:#79c0ff">\${d.avgImportance}</div><div style="font-size:11px;color:#8b949e;margin-top:2px">Avg importance</div></div>
    </div>
    <div style="margin-bottom:20px">
      <h4 style="margin:0 0 8px;font-size:12px;color:#8b949e;text-transform:uppercase;letter-spacing:.05em">Growth — last 30 days</h4>
      <canvas id="\${sparkId}" width="600" height="60" style="max-width:100%;border:1px solid #21262d;border-radius:6px;background:#0d1117"></canvas>
    </div>
    <div style="display:flex;gap:32px;flex-wrap:wrap">
      <div>\${section('By type',d.byType,'#58a6ff')}</div>
      <div>\${section('By trust',d.byTrust,'#3fb950')}</div>
      <div>\${section('By domain',d.byDomain,'#d2a8ff')}</div>
    </div>\`;
  g('ks-body').innerHTML = html;
  // Draw sparkline
  const cv = document.getElementById(sparkId);
  if (cv) {
    const ctx = cv.getContext('2d');
    const W = cv.width, H = cv.height, pad = 6;
    const step = (W - pad*2) / (d.growth.length - 1);
    ctx.strokeStyle = '#58a6ff'; ctx.lineWidth = 1.5; ctx.beginPath();
    d.growth.forEach((pt, i) => {
      const x = pad + i * step;
      const y = H - pad - ((pt.count / maxG) * (H - pad*2));
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
    // Fill area under line
    ctx.lineTo(pad + (d.growth.length-1)*step, H-pad);
    ctx.lineTo(pad, H-pad); ctx.closePath();
    ctx.fillStyle = 'rgba(88,166,255,0.12)'; ctx.fill();
  }
}

let _tcTimer = null;
async function loadTagCloud() {
  const d = await api('/api/tags/stats?limit=80');
  const cloud = g('tc-cloud');
  const top = g('tc-top');
  if (!d.top.length) { cloud.innerHTML='<p class="empty">No tags yet — add tags when creating memories.</p>'; top.innerHTML=''; return; }
  const max = d.top[0].count;
  const minPx = 12, maxPx = 32;
  const colors = ['#79c0ff','#3fb950','#d2a8ff','#ffa657','#f85149','#58a6ff'];
  cloud.innerHTML = d.top.map((t,i) => {
    const size = minPx + Math.round((t.count / max) * (maxPx - minPx));
    const col = colors[i % colors.length];
    return \`<span style="font-size:\${size}px;color:\${col};margin:0 8px;cursor:pointer;display:inline-block" onclick="filterByTag('\${esc(t.tag)}')" title="\${t.count} memories">#\${esc(t.tag)}</span>\`;
  }).join('');
  top.innerHTML = \`<table style="font-size:12px;border-collapse:collapse;width:100%;max-width:400px">\${d.top.slice(0,15).map((t,i)=>\`<tr><td style="padding:3px 8px;color:#8b949e">\${i+1}</td><td style="padding:3px 8px"><span style="cursor:pointer;color:#79c0ff" onclick="filterByTag('\${esc(t.tag)}')">#\${esc(t.tag)}</span></td><td style="padding:3px 8px;color:#8b949e">\${t.count}</td></tr>\`).join('')}</table>\`;
}
function filterByTag(tag) {
  const tf = g('mtag'); if (tf) { tf.value = tag; }
  document.querySelectorAll('nav button').forEach(b => { if (b.textContent==='Memories') b.click(); });
}
async function loadCoOccurrence() {
  clearTimeout(_tcTimer);
  _tcTimer = setTimeout(async () => {
    const tag = g('tc-co').value.trim().toLowerCase();
    if (!tag) { g('tc-co-out').style.display='none'; return; }
    const d = await api('/api/tags/stats?co='+encodeURIComponent(tag));
    if (!d.co.length) { g('tc-co-out').style.display='none'; return; }
    g('tc-co-list').innerHTML = d.co.map(t=>\`<span class="b" style="margin:3px;display:inline-block">#\${esc(t.tag)} <span style="color:#8b949e">\${t.count}</span></span>\`).join('');
    g('tc-co-out').style.display='block';
  }, 300);
}
async function showDiff(versionId) {
  const d = await api('/api/versions/'+versionId+'/diff');
  const lines = d.diff.map(op => {
    if (op.type==='add') return \`\x1b[32m+ \${op.text}\x1b[0m\`;
    if (op.type==='del') return \`\x1b[31m- \${op.text}\x1b[0m\`;
    return \`  \${op.text}\`;
  });
  const colored = d.diff.map(op => {
    const t = esc(op.text);
    if (op.type==='add') return \`<span style="color:#3fb950;display:block">+ \${t}</span>\`;
    if (op.type==='del') return \`<span style="color:#f85149;display:block">- \${t}</span>\`;
    return \`<span style="color:#8b949e;display:block">  \${t}</span>\`;
  }).join('');
  g('hist-diff-out').innerHTML = colored;
  g('hist-diff').style.display='block';
}
</script>
</body></html>`;
