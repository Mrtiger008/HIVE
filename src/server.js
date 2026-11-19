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

function handleSearch(req, res, q) {
  const query = q.q || '';
  const limit = +(q.limit) || 20;
  const projectId = q.project || null;
  if (!query.trim()) { json(res, []); return; }
  json(res, search(query, { limit, project_id: projectId }));
}

function handleMemories(req, res, q) {
  json(res, memory.list({
    type:       q.type       || undefined,
    trust_level: q.trust     || undefined,
    project_id: q.project    || undefined,
    limit:      +(q.limit)   || 50,
  }));
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

function handleProjects(req, res) {
  json(res, projects.list({ status: 'active', limit: 50 }));
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

async function handleDeleteMemory(req, res, id) {
  const m = memory.get(id);
  if (!m) { json(res, { error: 'not found' }, 404); return; }
  memory.update(id, { status: 'archived' });
  json(res, { ok: true });
}

function handleIndex(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(HTML);
}

const ROUTES = {
  'GET /api/stats':     handleStats,
  'GET /api/search':    handleSearch,
  'GET /api/memories':  handleMemories,
  'POST /api/memories': handleAddMemory,
  'GET /api/patterns':  handlePatterns,
  'GET /api/entities':  handleEntities,
  'GET /api/projects':  handleProjects,
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
    if (!handler && req.method === 'DELETE' && pathname.startsWith('/api/memories/')) {
      const id = pathname.slice('/api/memories/'.length);
      handler = (req, res) => handleDeleteMemory(req, res, id);
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
</style></head>
<body>
<header><h1>&#x1F9E0; HIVE</h1><span id="stats">loading…</span></header>
<nav>
  <button class="on" onclick="show('search',this)">Search</button>
  <button onclick="show('memories',this)">Memories</button>
  <button onclick="show('briefing',this)">Briefing</button>
  <button onclick="show('patterns',this)">Patterns</button>
  <button onclick="show('entities',this)">Entities</button>
</nav>

<div id="search" class="tab on">
  <div class="row">
    <input id="q" placeholder="Search memories…" onkeydown="if(event.key==='Enter')doSearch()">
    <button class="btn" onclick="doSearch()">Search</button>
  </div>
  <div id="sr"></div>
</div>

<div id="memories" class="tab">
  <div class="row">
    <select id="mtype" onchange="loadMem()"><option value="">All types</option><option>core</option><option>domain</option><option>project</option><option>episodic</option><option>semantic</option><option>skill</option></select>
    <select id="mtrust" onchange="loadMem()"><option value="">All trust</option><option>USER_CONFIRMED</option><option>SOURCE_VERIFIED</option><option>OBSERVED</option><option>INFERRED</option></select>
    <select id="mproj" onchange="loadMem()"><option value="">All projects</option></select>
    <button class="btn" onclick="showAdd()" style="margin-left:auto">+ Add Memory</button>
  </div>
  <div id="ml"></div>
</div>

<div id="briefing" class="tab">
  <div class="row"><button class="btn" onclick="loadBrief()">Load Briefing</button></div>
  <div id="brief-out"><p class="empty">Click "Load Briefing" to generate.</p></div>
</div>

<div id="patterns" class="tab"><div id="pc"></div></div>
<div id="entities" class="tab"><div id="el"></div></div>

<div id="add-modal" class="modal">
  <div class="mbox">
    <h3>Add Memory</h3>
    <div class="f"><label>Title *</label><input id="nm-t" style="width:100%" placeholder="Memory title"></div>
    <div class="f"><label>Content *</label><textarea id="nm-c" rows="5" placeholder="Memory content…"></textarea></div>
    <div class="f"><label>Type</label><select id="nm-ty"><option>semantic</option><option>core</option><option>domain</option><option>project</option><option>episodic</option><option>skill</option></select></div>
    <div class="f"><label>Trust</label><select id="nm-tr"><option>OBSERVED</option><option>USER_CONFIRMED</option><option>SOURCE_VERIFIED</option><option>INFERRED</option></select></div>
    <div class="f"><label>Importance (1–10)</label><input id="nm-i" type="number" min="1" max="10" value="5"></div>
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
}

function card(m) {
  const preview = (m.content||'').replace(/\\n/g,' ').slice(0,280);
  return \`<div class="card" data-id="\${m.id}">
    <div class="ct">\${esc(m.title)}<button class="arch" onclick="archiveMem('\${m.id}',this)" title="Archive">× archive</button></div>
    <div class="cm"><span class="b bt">\${m.memory_type}</span><span class="b br">\${m.trust_level}</span><span class="b bi">i=\${m.importance}</span></div>
    <div class="cc">\${esc(preview)}\${m.content.length>280?'…':''}</div>
  </div>\`;
}

async function doSearch() {
  const q = g('q').value.trim();
  if (!q) return;
  const d = await api('/api/search?q='+encodeURIComponent(q)+'&limit=20');
  g('sr').innerHTML = d.length ? d.map(card).join('') : '<p class="empty">No results.</p>';
}

async function loadMem() {
  let u = '/api/memories?limit=50';
  const t = g('mtype').value, r = g('mtrust').value, p = g('mproj').value;
  if (t) u += '&type='+t; if (r) u += '&trust='+r; if (p) u += '&project='+p;
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

function refreshStats() { api('/api/stats').then(d => g('stats').textContent = \`\${d.memories} memories · \${d.entities} entities · \${d.projects} projects\`); }
function showAdd() { g('nm-err').textContent=''; g('add-modal').classList.add('on'); }
function closeAdd() { g('add-modal').classList.remove('on'); }
async function submitAdd() {
  const title = g('nm-t').value.trim(), content = g('nm-c').value.trim();
  if (!title || !content) { g('nm-err').textContent = 'Title and content are required.'; return; }
  g('nm-err').textContent = '';
  const r = await fetch('/api/memories', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ title, content, memory_type: g('nm-ty').value, trust_level: g('nm-tr').value, importance: +g('nm-i').value }) });
  if (!r.ok) { const e = await r.json(); g('nm-err').textContent = e.error || 'Save failed.'; return; }
  g('nm-t').value = ''; g('nm-c').value = '';
  closeAdd(); loadMem(); refreshStats();
}
async function archiveMem(id, btn) {
  btn.textContent = '…';
  const r = await fetch(\`/api/memories/\${id}\`, { method:'DELETE' });
  if (r.ok) { btn.closest('.card').remove(); refreshStats(); }
  else btn.textContent = '× archive';
}
refreshStats();
api('/api/projects').then(ps => { const sel=g('mproj'); ps.forEach(p=>{const o=document.createElement('option');o.value=p.id;o.textContent=p.name;sel.appendChild(o);}); });
</script>
</body></html>`;
