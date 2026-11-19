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
    type:       q.type    || undefined,
    trust_level: q.trust  || undefined,
    project_id: q.project || undefined,
    limit:      +(q.limit) || 50,
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
  const nodes = db.prepare('SELECT id, name, entity_type FROM entities ORDER BY created_at DESC LIMIT ?').all(limit);
  const nodeIds = new Set(nodes.map(n => n.id));
  const edges = db.prepare('SELECT from_id, to_id, rel_type, confidence FROM relationships').all()
    .filter(r => nodeIds.has(r.from_id) && nodeIds.has(r.to_id));
  json(res, { nodes, edges });
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
    tags:        body.tags        || [],
  });
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
  if (body.tags        !== undefined) updates.tags        = body.tags;
  if (!Object.keys(updates).length) { json(res, { error: 'no fields to update' }, 400); return; }
  json(res, memory.update(id, updates));
}

async function handleDeleteMemory(req, res, id) {
  const m = memory.get(id);
  if (!m) { json(res, { error: 'not found' }, 404); return; }
  memory.update(id, { status: 'archived' });
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

function handleIndex(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(HTML);
}

const ROUTES = {
  'GET /api/stats':     handleStats,
  'GET /api/search':         handleSearch,
  'GET /api/search/history': handleSearchHistory,
  'GET /api/tags':           handleTags,
  'GET /api/activity':       handleActivity,
  'GET /api/memories':  handleMemories,
  'POST /api/memories':      handleAddMemory,
  'POST /api/memories/bulk': handleBulk,
  'GET /api/patterns':  handlePatterns,
  'GET /api/graph':     handleGraph,
  'GET /api/entities':  handleEntities,
  'GET /api/projects':  handleProjects,
  'GET /api/export':    handleExport,
  'GET /api/review':    handleReview,
  'GET /api/brief':     handleBrief,
  'GET /':              handleIndex,
};

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
    }
    if (!handler) { res.writeHead(404); res.end('Not Found'); return; }
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
  <div id="gleg" class="legend"></div>
  <canvas id="gc"></canvas>
  <p id="gmt" class="empty" style="display:none">No entities yet — add some via the CLI or the Memories tab.</p>
</div>

<div id="projects" class="tab"><div id="pl"><p class="empty">Loading…</p></div></div>
<div id="activity" class="tab"><div id="al"><p class="empty">Loading…</p></div></div>
<div id="review" class="tab"><div class="row"><button class="btn" onclick="loadReview()">Load Review Digest</button></div><div id="rv"><p class="empty">Click "Load Review Digest" to see memories due for review.</p></div></div>

<div id="add-modal" class="modal">
  <div class="mbox">
    <h3 id="nm-h">Add Memory</h3>
    <div class="f"><label>Title *</label><input id="nm-t" style="width:100%" placeholder="Memory title"></div>
    <div class="f"><label>Content *</label><textarea id="nm-c" rows="5" placeholder="Memory content…"></textarea></div>
    <div class="f"><label>Type</label><select id="nm-ty"><option>semantic</option><option>core</option><option>domain</option><option>project</option><option>episodic</option><option>skill</option></select></div>
    <div class="f"><label>Trust</label><select id="nm-tr"><option>OBSERVED</option><option>USER_CONFIRMED</option><option>SOURCE_VERIFIED</option><option>INFERRED</option></select></div>
    <div class="f"><label>Importance (1–10)</label><input id="nm-i" type="number" min="1" max="10" value="5"></div>
    <div class="f"><label>Tags <span style="font-weight:normal;color:#8b949e">(comma-separated)</span></label><input id="nm-tg" style="width:100%" placeholder="e.g. javascript, async, todo"></div>
    <p id="nm-err" class="merr"></p>
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
}

function card(m) {
  const preview = (m.content||'').replace(/\\n/g,' ').slice(0,280);
  const tags = (m.tags||[]).map(t=>\`<span class="b" style="cursor:pointer;color:#79c0ff" onclick="filterTag('\${esc(t)}')">#\${esc(t)}</span>\`).join(' ');
  return \`<div class="card" data-id="\${m.id}">
    <div class="ct"><input type="checkbox" style="margin-right:8px;cursor:pointer" onchange="toggleSel('\${m.id}',this.checked)">\${esc(m.title)}<button class="arch" onclick="archiveMem('\${m.id}',this)" title="Archive">× archive</button><button class="arch" onclick="showEdit('\${m.id}')" title="Edit">✎ edit</button></div>
    <div class="cm"><span class="b bt">\${m.memory_type}</span><span class="b br">\${m.trust_level}</span><span class="b bi">i=\${m.importance}</span>\${tags}</div>
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
  const t = g('mtype').value, r = g('mtrust').value, p = g('mproj').value, tg = g('mtag').value;
  if (t) u += '&type='+t; if (r) u += '&trust='+r; if (p) u += '&project='+p; if (tg) u += '&tag='+encodeURIComponent(tg);
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

let gStop = null;
async function loadGraph() {
  if (gStop) { gStop(); gStop = null; }
  const data = await api('/api/graph?limit=100');
  const gc = g('gc'), gmt = g('gmt');
  if (!data.nodes.length) { gmt.style.display='block'; gc.style.display='none'; return; }
  gmt.style.display='none'; gc.style.display='block';
  const C = {person:'#58a6ff',tool:'#3fb950',org:'#d2a8ff',concept:'#f0883e',project:'#79c0ff',file:'#ffa657',domain:'#ff7b72',other:'#8b949e'};
  const types = [...new Set(data.nodes.map(n=>n.entity_type))];
  g('gleg').innerHTML = types.map(t=>'<div class="lk"><div class="lc" style="background:'+(C[t]||'#8b949e')+'"></div>'+esc(t)+'</div>').join('');
  const W = gc.width = gc.parentElement.clientWidth - 48 || 800;
  const H = gc.height = 500;
  const ctx = gc.getContext('2d');
  const ns = data.nodes.map(n=>({...n,x:W/2+(Math.random()-.5)*300,y:H/2+(Math.random()-.5)*300,vx:0,vy:0}));
  const nm = {};
  ns.forEach(n=>{nm[n.id]=n;});
  const es = data.edges.filter(e=>nm[e.from_id]&&nm[e.to_id]);
  let drag = null;
  gc.onmousedown=e=>{const r=gc.getBoundingClientRect(),mx=e.clientX-r.left,my=e.clientY-r.top;drag=ns.find(n=>Math.hypot(n.x-mx,n.y-my)<10)||null;if(drag)drag.fixed=true;};
  gc.onmousemove=e=>{if(!drag)return;const r=gc.getBoundingClientRect();drag.x=e.clientX-r.left;drag.y=e.clientY-r.top;};
  gc.onmouseup=()=>{if(drag){drag.fixed=false;drag=null;}};
  let raf;
  function tick(){
    for(let i=0;i<ns.length;i++)for(let j=i+1;j<ns.length;j++){const a=ns[i],b=ns[j],dx=b.x-a.x,dy=b.y-a.y,d=Math.sqrt(dx*dx+dy*dy)||1,f=3000/(d*d);a.vx-=dx/d*f;a.vy-=dy/d*f;b.vx+=dx/d*f;b.vy+=dy/d*f;}
    for(const e of es){const a=nm[e.from_id],b=nm[e.to_id],dx=b.x-a.x,dy=b.y-a.y,d=Math.sqrt(dx*dx+dy*dy)||1,f=(d-120)*.03;a.vx+=dx/d*f;a.vy+=dy/d*f;b.vx-=dx/d*f;b.vy-=dy/d*f;}
    for(const n of ns){n.vx+=(W/2-n.x)*.002;n.vy+=(H/2-n.y)*.002;}
    for(const n of ns){if(n.fixed)continue;n.vx*=.85;n.vy*=.85;n.x=Math.max(20,Math.min(W-20,n.x+n.vx));n.y=Math.max(20,Math.min(H-20,n.y+n.vy));}
    ctx.clearRect(0,0,W,H);
    ctx.strokeStyle='#30363d';ctx.lineWidth=1;
    for(const e of es){const a=nm[e.from_id],b=nm[e.to_id];ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
    for(const n of ns){ctx.fillStyle=C[n.entity_type]||'#8b949e';ctx.beginPath();ctx.arc(n.x,n.y,8,0,Math.PI*2);ctx.fill();ctx.fillStyle='#c9d1d9';ctx.font='11px sans-serif';ctx.textAlign='center';ctx.fillText(n.name.length>18?n.name.slice(0,17)+'...':n.name,n.x,n.y+20);}
    raf=requestAnimationFrame(tick);
  }
  tick();
  gStop=()=>cancelAnimationFrame(raf);
}

function refreshStats() { api('/api/stats').then(d => g('stats').textContent = \`\${d.memories} memories · \${d.entities} entities · \${d.projects} projects\`); }
let _editId = null;
function showAdd() { _editId=null; g('nm-h').textContent='Add Memory'; g('nm-t').value=''; g('nm-c').value=''; g('nm-ty').value='semantic'; g('nm-tr').value='OBSERVED'; g('nm-i').value='5'; g('nm-tg').value=''; g('nm-err').textContent=''; g('add-modal').classList.add('on'); }
async function showEdit(id) { const d=await api('/api/memories/'+id); _editId=id; g('nm-h').textContent='Edit Memory'; g('nm-t').value=d.title||''; g('nm-c').value=d.content||''; g('nm-ty').value=d.memory_type||'semantic'; g('nm-tr').value=d.trust_level||'OBSERVED'; g('nm-i').value=d.importance||5; g('nm-tg').value=(d.tags||[]).join(', '); g('nm-err').textContent=''; g('add-modal').classList.add('on'); }
function closeAdd() { g('add-modal').classList.remove('on'); }
async function submitAdd() {
  const title = g('nm-t').value.trim(), content = g('nm-c').value.trim();
  if (!title || !content) { g('nm-err').textContent = 'Title and content are required.'; return; }
  g('nm-err').textContent = '';
  const rawTags = g('nm-tg').value.split(',').map(t=>t.trim()).filter(Boolean);
  const payload = { title, content, memory_type: g('nm-ty').value, trust_level: g('nm-tr').value, importance: +g('nm-i').value, tags: rawTags };
  const r = _editId
    ? await fetch('/api/memories/'+_editId, { method:'PUT',  headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) })
    : await fetch('/api/memories',           { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
  if (!r.ok) { const e = await r.json(); g('nm-err').textContent = e.error || 'Save failed.'; return; }
  g('nm-t').value = ''; g('nm-c').value = '';
  closeAdd(); loadMem(); refreshStats(); loadTagSelect();
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
</script>
</body></html>`;
