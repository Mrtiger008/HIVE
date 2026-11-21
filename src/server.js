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
const links            = require('./links');
const bookmarks        = require('./bookmarks');
const digest           = require('./digest');
const decay            = require('./decay');
const obsidian         = require('./obsidian');
const conflicts        = require('./conflicts');
const memgraph         = require('./memgraph');
const timeline         = require('./timeline');
const clusters         = require('./clusters');
const reminders        = require('./reminders');
const shortcuts        = require('./shortcuts');
const compare          = require('./compare');
const gaps             = require('./gaps');
const health           = require('./health');
const calibrate        = require('./calibrate');
const importer         = require('./importer');

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
    pinned:   db.prepare("SELECT COUNT(*) as n FROM memories WHERE status='active' AND pinned=1").get().n,
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

async function handleTagRename(req, res) {
  const body = await readBody(req);
  const { from, to } = body;
  if (!from || !to || from === to) { json(res, { error: 'from and to required and must differ' }, 400); return; }
  const toClean = to.trim().toLowerCase().replace(/\s+/g, '-');
  if (!toClean) { json(res, { error: 'invalid tag name' }, 400); return; }
  const db = getDb();
  const rows = db.prepare("SELECT id, tags FROM memories WHERE status='active' AND tags IS NOT NULL AND tags != '[]'").all();
  let updated = 0;
  const now = Date.now();
  for (const row of rows) {
    const tags = JSON.parse(row.tags || '[]');
    if (!tags.includes(from)) continue;
    const newTags = tags.map(t => t === from ? toClean : t);
    db.prepare('UPDATE memories SET tags = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(newTags), now, row.id);
    updated++;
  }
  json(res, { renamed: from, to: toClean, updated });
}

async function handleTagMerge(req, res) {
  const body = await readBody(req);
  const { from, into } = body;
  if (!from || !into || from === into) { json(res, { error: 'from and into required and must differ' }, 400); return; }
  const intoClean = into.trim().toLowerCase().replace(/\s+/g, '-');
  if (!intoClean) { json(res, { error: 'invalid tag name' }, 400); return; }
  const db = getDb();
  const rows = db.prepare("SELECT id, tags FROM memories WHERE status='active' AND tags IS NOT NULL AND tags != '[]'").all();
  let updated = 0;
  const now = Date.now();
  for (const row of rows) {
    const tags = JSON.parse(row.tags || '[]');
    if (!tags.includes(from)) continue;
    const newTags = tags.filter(t => t !== from);
    if (!newTags.includes(intoClean)) newTags.push(intoClean);
    db.prepare('UPDATE memories SET tags = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(newTags), now, row.id);
    updated++;
  }
  json(res, { merged: from, into: intoClean, updated });
}

function handleSearchHistory(req, res, q) {
  const limit = +(q.limit) || 20;
  const rows = getDb().prepare(
    'SELECT query, MAX(searched_at) as last_used, COUNT(*) as times FROM search_history GROUP BY query ORDER BY last_used DESC LIMIT ?'
  ).all(limit);
  json(res, rows);
}

function handleSuggest(req, res, q) {
  const query = (q.q || '').trim();
  if (!query || query.length < 2) { json(res, []); return; }
  const db = getDb();
  const like = '%' + query + '%';
  const titles = db.prepare(
    "SELECT id, title FROM memories WHERE title LIKE ? AND status='active' LIMIT 5"
  ).all(like);
  let tagRows = [];
  try {
    tagRows = db.prepare(
      "SELECT DISTINCT value FROM memories, json_each(memories.tags) WHERE value LIKE ? AND memories.status='active' LIMIT 4"
    ).all(like);
  } catch {}
  const titleSet = new Set(titles.map(m => m.title));
  const items = [
    ...titles.map(m => ({ type: 'title', label: m.title, id: m.id })),
    ...tagRows.map(r => r.value).filter(t => !titleSet.has(t)).map(t => ({ type: 'tag', label: t }))
  ];
  json(res, items.slice(0, 8));
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
  const notesOnly = q.notes_only === '1';
  json(res, search(query, { limit, project_id: projectId, notes_only: notesOnly }));
}

const MEM_PAGE = 50; // memories per page

function handleMemories(req, res, q) {
  const pageSize = q.limit ? +(q.limit) : MEM_PAGE;
  const offset   = q.offset ? +(q.offset) : 0;
  const needsPostFilter = q.tag || q.pinned || q.starred || q.label || q.min_words || q.max_words || q.read_time || q.expires;
  let results = memory.list({
    type:           q.type           || undefined,
    trust_level:    q.trust          || undefined,
    project_id:     q.project        || undefined,
    domain:         q.domain         || undefined,
    sort:           q.sort           || undefined,
    limit:          needsPostFilter ? 100000 : pageSize,
    offset:         needsPostFilter ? 0       : offset,
    min_conf:       q.min_conf       != null ? +q.min_conf       : undefined,
    max_conf:       q.max_conf       != null ? +q.max_conf       : undefined,
    min_importance: q.min_importance != null ? +q.min_importance : undefined,
  });
  if (q.tag)    results = results.filter(m => (m.tags || []).includes(q.tag));
  if (q.pinned)  results = results.filter(m => m.pinned  === 1 || m.pinned  === true);
  if (q.starred) results = results.filter(m => m.starred === 1 || m.starred === true);
  if (q.label)     results = results.filter(m => m.label === q.label);
  if (q.min_words) { const n=+q.min_words; results = results.filter(m => (m.content||'').trim().split(/\s+/).filter(Boolean).length >= n); }
  if (q.max_words) { const n=+q.max_words; results = results.filter(m => (m.content||'').trim().split(/\s+/).filter(Boolean).length <= n); }
  if (q.read_time) {
    const wc = m => (m.content||'').trim().split(/\s+/).filter(Boolean).length;
    if (q.read_time === 'quick')  results = results.filter(m => wc(m) <  100);
    if (q.read_time === 'medium') results = results.filter(m => { const w=wc(m); return w >= 100 && w <= 400; });
    if (q.read_time === 'long')   results = results.filter(m => wc(m) >  400);
  }
  if (q.expires) {
    const now = Date.now();
    if (q.expires === 'expired') results = results.filter(m => m.expires_at && m.expires_at < now);
    if (q.expires === 'soon')    results = results.filter(m => m.expires_at && m.expires_at >= now && m.expires_at < now + 7 * 86400000);
    if (q.expires === 'any')     results = results.filter(m => m.expires_at != null);
  }
  // For post-filter case apply client-side pagination
  if (needsPostFilter) results = results.slice(offset, offset + pageSize);
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
    if (q.ids) {
      const ids = q.ids.split(',').map(s => s.trim()).filter(Boolean);
      const rows = ids.map(id => memory.get(id)).filter(Boolean);
      res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="hive-selection.csv"' });
      res.end(exportCsv(rows));
      return;
    }
    let rows = null;
    const hasFilter = q.tag || q.type || q.project || q.domain || q.trust || q.min_importance || q.label;
    if (hasFilter) {
      rows = memory.list({
        type:           q.type           || undefined,
        trust_level:    q.trust          || undefined,
        project_id:     q.project        || undefined,
        domain:         q.domain         || undefined,
        min_importance: q.min_importance != null ? +q.min_importance : undefined,
        limit: 100000,
      });
      if (q.tag)   rows = rows.filter(m => (m.tags || []).includes(q.tag));
      if (q.label) rows = rows.filter(m => m.label === q.label);
    }
    const filename = hasFilter ? 'hive-filtered.csv' : 'hive-export.csv';
    res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="${filename}"` });
    res.end(exportCsv(rows));
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

function handleDuplicate(req, res, id) {
  const src = memory.get(id);
  if (!src) { json(res, { error: 'Memory not found' }, 404); return; }
  const dup = memory.add({
    title: 'Copy of ' + src.title,
    content: src.content,
    memory_type: src.memory_type,
    domain: src.domain || undefined,
    project_id: src.project_id || undefined,
    trust_level: src.trust_level,
    confidence: src.confidence,
    importance: src.importance,
    tags: src.tags || [],
  });
  json(res, dup);
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

function _quickTitle(text, max = 60) {
  const t = text.trim().replace(/\s+/g, ' ');
  if (t.length <= max) return t;
  const cut = t.lastIndexOf(' ', max);
  return (cut > 20 ? t.slice(0, cut) : t.slice(0, max)) + '…';
}

async function handleCapture(req, res) {
  const body = await readBody(req);
  if (!body.content?.trim()) { json(res, { error: 'content required' }, 400); return; }
  const text = body.content.trim().replace(/\s+/g, ' ');
  const m = memory.add({
    title:       _quickTitle(text),
    content:     text,
    memory_type: body.type || 'semantic',
    domain:      body.domain || undefined,
    trust_level: 'OBSERVED',
    confidence:  0.7,
    importance:  body.importance != null ? +body.importance : 5,
  });
  webhooks.fire('memory.created', { id: m.id, title: m.title, memory_type: m.memory_type, trust_level: m.trust_level, importance: m.importance });
  json(res, m, 201);
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
    domain:      body.domain      || undefined,
    project_id:  body.project_id  || undefined,
    label:       body.label       || undefined,
    note:        body.note        || undefined,
    expires_at:  body.expires_at  || undefined,
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
  if (body.pinned      !== undefined) updates.pinned      = body.pinned ? 1 : 0;
  if (body.label       !== undefined) updates.label       = body.label || null;
  if (body.note        !== undefined) updates.note        = body.note  || null;
  if (body.expires_at  !== undefined) updates.expires_at  = body.expires_at || null;
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

async function handleMerge(req, res) {
  const { keep, discard } = await readBody(req);
  if (!keep || !discard || keep === discard) { json(res, { error: 'keep and discard ids required and must differ' }, 400); return; }
  const keepMem = memory.get(keep);
  const discardMem = memory.get(discard);
  if (!keepMem || !discardMem) { json(res, { error: 'memory not found' }, 404); return; }
  const db = getDb();
  const tagSet = new Set([...(keepMem.tags || []), ...(discardMem.tags || [])]);
  // Transfer relationships from discard to keep, skip self-links
  db.prepare('UPDATE relationships SET from_id=? WHERE from_id=? AND to_id!=?').run(keep, discard, keep);
  db.prepare('UPDATE relationships SET to_id=? WHERE to_id=? AND from_id!=?').run(keep, discard, keep);
  db.prepare('DELETE FROM relationships WHERE from_id=? OR to_id=?').run(discard, discard);
  memory.update(keep, { tags: [...tagSet] });
  memory.update(discard, { status: 'archived' });
  json(res, memory.get(keep));
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
      else if (action === 'add_tags' && updates?.tags) {
        const m = memory.get(id);
        if (m) { const s = new Set(m.tags || []); updates.tags.forEach(t => s.add(t)); memory.update(id, { tags: [...s] }); count++; }
      }
      else if (action === 'remove_tags' && updates?.tags) {
        const m = memory.get(id);
        if (m) { const rm = new Set(updates.tags); memory.update(id, { tags: (m.tags || []).filter(t => !rm.has(t)) }); count++; }
      }
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

function handlePin(req, res, id, pinned) {
  const m = memory.get(id);
  if (!m) { json(res, { error: 'not found' }, 404); return; }
  json(res, memory.update(id, { pinned }));
}

function handleStar(req, res, id, starred) {
  const m = memory.get(id);
  if (!m) { json(res, { error: 'not found' }, 404); return; }
  json(res, memory.update(id, { starred }));
}

function handleListBookmarks(req, res) {
  json(res, bookmarks.list());
}

async function handleAddBookmark(req, res) {
  const body = await readBody(req);
  if (!body.name || !body.query) { json(res, { error: 'name and query required' }, 400); return; }
  try {
    json(res, bookmarks.add(body.name, body.query, body.mode || 'keyword'), 201);
  } catch (e) {
    json(res, { error: e.message.includes('UNIQUE') ? 'name already exists' : e.message },
      e.message.includes('UNIQUE') ? 409 : 400);
  }
}

function handleDeleteBookmark(req, res, id) {
  const n = bookmarks.remove(+id);
  if (!n) { json(res, { error: 'not found' }, 404); return; }
  json(res, { ok: true });
}

function handleListLinks(req, res, id) {
  const m = memory.get(id);
  if (!m) { json(res, { error: 'not found' }, 404); return; }
  json(res, links.list(id));
}

async function handleAddLink(req, res, id) {
  const body = await readBody(req);
  if (!body.to_id) { json(res, { error: 'to_id required' }, 400); return; }
  try {
    const link = links.add(id, body.rel_type || 'related', body.to_id, body.notes || null);
    json(res, link, 201);
  } catch (e) {
    json(res, { error: e.message }, e.message.includes('not found') ? 404 : 400);
  }
}

function handleRemoveLink(req, res, linkId) {
  const n = links.remove(linkId);
  if (!n) { json(res, { error: 'not found' }, 404); return; }
  json(res, { ok: true });
}

function handleTagStats(req, res, q) {
  const limit = +(q.limit) || 50;
  const top = tags.topTags(limit);
  const coTag = q.co;
  const co = coTag ? tags.coOccurrence(coTag, 10) : [];
  json(res, { top, co, coTag: coTag || null });
}

function handleTagHeatmap(req, res, q) {
  const tag = (q.tag || '').trim();
  if (!tag) { json(res, { error: 'tag required' }, 400); return; }
  const db = getDb();
  // Return weekly buckets for the last 52 weeks (ISO year-week keys)
  const rows = db.prepare(
    "SELECT strftime('%Y-%W', created_at/1000, 'unixepoch') as week, COUNT(*) as count " +
    "FROM memories WHERE status='active' AND tags LIKE ? GROUP BY week ORDER BY week"
  ).all(`%"${tag}"%`);
  json(res, rows);
}

function handleListVersions(req, res, id) {
  const m = memory.get(id);
  if (!m) { json(res, { error: 'not found' }, 404); return; }
  json(res, versions.list(id));
}

function handleRelated(req, res, id, limit) {
  const m = memory.get(id);
  if (!m) { json(res, { error: 'not found' }, 404); return; }
  const terms = [m.title, ...(m.tags || []), ...(m.retrieval_keywords || [])].join(' ');
  const results = search(terms, { limit: limit + 1 });
  json(res, results.filter(r => r.id !== id).slice(0, limit));
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
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(HTML);
}

const ROUTES = {
  'GET /api/stats':          handleStats,
  'GET /api/search':          handleSearch,
  'GET /api/search/suggest':  handleSuggest,
  'GET /api/search/history':  handleSearchHistory,
  'GET /api/tags':           handleTags,
  'GET /api/activity':       handleActivity,
  'GET /api/memories':         handleMemories,
  'GET /api/memories/similar': handleSimilar,
  'POST /api/capture':         handleCapture,
  'POST /api/memories':        handleAddMemory,
  'POST /api/memories/merge':  handleMerge,
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
  'GET /api/digest':         (req, res) => {
    const u = new URL(req.url, 'http://localhost');
    const period = u.searchParams.get('period') || 'daily';
    json(res, period === 'weekly' ? digest.weekly() : digest.daily());
  },
  'GET /api/decay/preview':  (req, res) => {
    const u = new URL(req.url, 'http://localhost');
    const minIdleDays = u.searchParams.get('min_idle_days') ? +u.searchParams.get('min_idle_days') : 14;
    json(res, { changes: decay.preview({ minIdleDays }) });
  },
  'GET /api/export/obsidian': (req, res) => json(res, obsidian.generate()),
  'GET /api/memories/graph': (req, res) => json(res, memgraph.build()),
  'GET /api/shortcuts': (req, res) => json(res, { shortcuts: shortcuts.SHORTCUTS }),
  'GET /api/calibrate/preview': (req, res) => {
    const q = new URL(req.url, 'http://x').searchParams;
    json(res, calibrate.preview({ limit: q.get('limit') ? +q.get('limit') : 500 }));
  },
  'POST /api/import/dir': async (req, res) => {
    const body = await readBody(req).catch(() => ({}));
    const dirPath = (body.path || '').trim();
    if (!dirPath) { json(res, { error: 'path is required' }, 400); return; }
    try { json(res, importer.importDir(dirPath, { auto: !!body.auto, limit: body.limit || 500 })); }
    catch (e) { json(res, { error: e.message }, 400); }
  },
  'POST /api/calibrate/apply': async (req, res) => {
    const body = await readBody(req).catch(() => ({}));
    json(res, calibrate.apply({ limit: body.limit || 500 }));
  },
  'GET /api/domains': (req, res) => {
    const rows = getDb().prepare("SELECT DISTINCT domain FROM memories WHERE status='active' AND domain IS NOT NULL ORDER BY domain").all();
    json(res, rows.map(r => r.domain));
  },
  'GET /api/health': (req, res) => {
    const q = new URL(req.url, 'http://x').searchParams;
    json(res, health.list({
      limit:       q.get('limit') ? +q.get('limit') : 50,
      gradeFilter: q.get('grade') || undefined,
      domain:      q.get('domain') || undefined,
      sortOrder:   q.get('sort') || 'asc',
    }));
  },
  'GET /api/gaps': (req, res) => {
    const q = new URL(req.url, 'http://x').searchParams;
    json(res, gaps.get({
      minCount:       q.get('min_count')   ? +q.get('min_count')   : 3,
      confThreshold:  q.get('conf')        ? +q.get('conf')        : 0.5,
      importanceFloor:q.get('importance')  ? +q.get('importance')  : 7,
      limit:          q.get('limit')       ? +q.get('limit')       : 20,
    }));
  },
  'GET /api/memories/compare': (req, res) => {
    const q = new URL(req.url, 'http://x').searchParams;
    const id1 = q.get('id1'), id2 = q.get('id2');
    if (!id1 || !id2) return json(res, { error: 'id1 and id2 required' }, 400);
    try { json(res, compare.diff(id1, id2)); }
    catch (e) { json(res, { error: e.message }, 404); }
  },
  'GET /api/reminders': (req, res) => {
    const q = new URL(req.url, 'http://x').searchParams;
    json(res, reminders.get({
      limit:         q.get('limit')    ? +q.get('limit')   : 20,
      urgencyFilter: q.get('urgency')  || null,
      projectId:     q.get('project')  || null,
    }));
  },
  'POST /api/reminders/reviewed': async (req, res) => {
    const body = await readBody(req);
    try { json(res, reminders.markReviewed(body.id)); }
    catch (e) { json(res, { error: e.message }, 404); }
  },
  'GET /api/clusters': (req, res) => {
    const q = new URL(req.url, 'http://x').searchParams;
    json(res, clusters.get({
      minShared: q.get('min_shared') ? +q.get('min_shared') : 2,
      limit:     q.get('limit')      ? +q.get('limit')      : 20,
    }));
  },
  'GET /api/timeline': (req, res) => {
    const q = new URL(req.url, 'http://x').searchParams;
    json(res, timeline.get({
      days:        q.get('days')        ? +q.get('days')        : 30,
      granularity: q.get('granularity') || 'day',
      memory_type: q.get('type')        || null,
      domain:      q.get('domain')      || null,
    }));
  },
  'GET /api/conflicts':      (req, res) => json(res, conflicts.detect()),
  'POST /api/conflicts':     async (req, res) => {
    const body = await readBody(req);
    if (!body.id1 || !body.id2) { json(res, { error: 'id1 and id2 required' }, 400); return; }
    try { json(res, conflicts.markConflict(body.id1, body.id2, body.notes || null)); }
    catch (e) { json(res, { error: e.message }, 400); }
  },
  'POST /api/decay/run':     async (req, res) => {
    const body = await readBody(req).catch(() => ({}));
    const minIdleDays = body.min_idle_days || 14;
    json(res, decay.run({ minIdleDays }));
  },
  'GET /api/bookmarks':      handleListBookmarks,
  'POST /api/bookmarks':     handleAddBookmark,
  'GET /api/tags/stats':     (req, res) => { const u = new URL(req.url,'http://l'); handleTagStats(req, res, Object.fromEntries(u.searchParams)); },
  'GET /api/tags/heatmap':   (req, res) => { const u = new URL(req.url,'http://l'); handleTagHeatmap(req, res, Object.fromEntries(u.searchParams)); },
  'POST /api/tags/rename':   handleTagRename,
  'POST /api/tags/merge':    handleTagMerge,
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
      const rs = pathname.match(/^\/api\/memories\/([^/]+)\/resolve$/);
      if (rs && req.method === 'POST') {
        const id = rs[1];
        handler = async (req, res) => {
          const body = await readBody(req);
          try { json(res, conflicts.resolve(id, body.action || 'trust')); }
          catch (e) { json(res, { error: e.message }, e.message.startsWith('Memory') ? 404 : 400); }
        };
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
      const pin = pathname.match(/^\/api\/memories\/([^/]+)\/(pin|unpin)$/);
      if (pin && req.method === 'POST') {
        handler = (req, res) => handlePin(req, res, pin[1], pin[2] === 'pin' ? 1 : 0);
      }
      const star = pathname.match(/^\/api\/memories\/([^/]+)\/(star|unstar)$/);
      if (star && req.method === 'POST') {
        handler = (req, res) => handleStar(req, res, star[1], star[2] === 'star' ? 1 : 0);
      }
      const lk = pathname.match(/^\/api\/memories\/([^/]+)\/links$/);
      if (lk) {
        if (req.method === 'GET')  handler = (req, res) => handleListLinks(req, res, lk[1]);
        if (req.method === 'POST') handler = (req, res) => handleAddLink(req, res, lk[1]);
      }
      const ld = pathname.match(/^\/api\/links\/([^/]+)$/);
      if (ld && req.method === 'DELETE') {
        handler = (req, res) => handleRemoveLink(req, res, ld[1]);
      }
      const bk = pathname.match(/^\/api\/bookmarks\/(\d+)$/);
      if (bk && req.method === 'DELETE') {
        handler = (req, res) => handleDeleteBookmark(req, res, bk[1]);
      }
      const vd = pathname.match(/^\/api\/versions\/(\d+)\/diff$/);
      if (vd && req.method === 'GET') {
        handler = (req, res) => handleGetVersion(req, res, vd[1]);
      }
      const rl = pathname.match(/^\/api\/memories\/([^/]+)\/related$/);
      if (rl && req.method === 'GET') {
        const rlId = rl[1];
        handler = (req, res) => {
          const lim = Math.min(parseInt(new URL(req.url,'http://x').searchParams.get('limit')||'5',10),20);
          handleRelated(req, res, rlId, lim);
        };
      }
      const dup = pathname.match(/^\/api\/memories\/([^/]+)\/duplicate$/);
      if (dup && req.method === 'POST') {
        handler = (req, res) => handleDuplicate(req, res, dup[1]);
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
.tpl-chip{background:#21262d;border:1px solid #30363d;color:#8b949e;border-radius:12px;padding:3px 10px;font-size:12px;cursor:pointer;transition:all .15s}
.tpl-chip:hover{border-color:#58a6ff;color:#58a6ff}
.tpl-chip.on{background:#1f4b2b;border-color:#3fb950;color:#3fb950}
#srch-sug{position:fixed;background:#161b22;border:1px solid #30363d;border-radius:6px;box-shadow:0 8px 24px rgba(0,0,0,.5);z-index:9999;overflow:hidden;display:none;min-width:260px}
#srch-sug .ss-item{padding:7px 12px;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;color:#e6edf3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#srch-sug .ss-item:hover,#srch-sug .ss-item.on{background:#1f2937}
#srch-sug .ss-type{font-size:10px;padding:2px 5px;border-radius:3px;background:#21262d;color:#8b949e;flex-shrink:0}
#srch-sug .ss-type.tag{background:#0d2a1f;color:#3fb950}
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
<header><h1>&#x1F9E0; HIVE</h1><span id="stats">loading…</span><span style="margin-left:auto;display:flex;gap:8px"><a href="/api/export?format=json" download="hive-export.json" class="btn" style="text-decoration:none;font-size:12px">⬇ JSON</a><a href="/api/export?format=csv" download="hive-export.csv" class="btn" style="text-decoration:none;font-size:12px">⬇ CSV</a><button class="btn" style="font-size:12px" onclick="obsidianExport()">⬇ Obsidian</button></span></header>
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
  <button onclick="show('digest',this);loadDigest()">Digest</button>
  <button onclick="show('decay',this);loadDecayPreview()">Decay</button>
  <button onclick="show('conflicts',this);loadConflicts()">Conflicts</button>
  <button onclick="show('memgraph',this);loadMemGraph()">Mem Graph</button>
  <button onclick="show('timeline',this);loadTimeline()">Timeline</button>
  <button onclick="show('clusters',this);loadClusters()">Clusters</button>
  <button onclick="show('reminders',this);loadReminders()" id="rem-btn">Reminders</button>
  <button onclick="show('compare',this);initCompare()">Compare</button>
  <button onclick="show('gaps',this);loadGaps()">Gaps</button>
  <button onclick="show('health',this);loadHealth()">Health</button>
  <button onclick="show('calibrate',this);loadCalibrate()">Calibrate</button>
  <button onclick="show('import',this)">Import</button>
  <button onclick="toggleHelp()" title="Keyboard shortcuts" style="margin-left:auto;opacity:.7">?</button>
</nav>

<div id="search" class="tab on">
  <div class="row">
    <input id="q" placeholder="Search memories…" oninput="suggestDebounce(this.value)" onkeydown="if(event.key==='Enter'){var _si=document.querySelector('#srch-sug .ss-item.on');if(_si){pickSuggest(_si);}else{doSearch();}hideSuggest();}else if(event.key==='Escape'){hideSuggest();}else if(event.key==='ArrowDown'||event.key==='ArrowUp'){suggestNav(event);}" list="q-history" autocomplete="off">
    <datalist id="q-history"></datalist>
    <div id="srch-sug"></div>
    <select id="smode" title="Search mode"><option value="keyword">Keyword</option><option value="hybrid">Hybrid</option><option value="semantic">Semantic</option></select>
    <label style="display:flex;align-items:center;gap:4px;font-size:12px;color:#8b949e;white-space:nowrap;cursor:pointer" title="Only return memories where the query matches the note field"><input type="checkbox" id="snotes"> 🗒 notes only</label>
    <button class="btn" onclick="doSearch()">Search</button>
    <button class="btn" style="margin-left:4px" onclick="saveBookmark()" title="Save this search">★ Save</button>
    <button id="sr-csv-btn" class="btn" style="margin-left:4px;display:none" onclick="exportSearchCsv()" title="Export results as CSV">⬇ CSV</button>
    <span id="sr-count" style="font-size:12px;color:#8b949e;margin-left:8px"></span>
  </div>
  <div id="bk-bar" style="display:none;padding:6px 0 10px;border-bottom:1px solid #21262d;margin-bottom:10px;font-size:12px;color:#8b949e">
    <span style="margin-right:8px">Bookmarks:</span><span id="bk-chips"></span>
  </div>
  <div id="sr"></div>
</div>

<div id="memories" class="tab">
  <div class="row">
    <select id="mtype" onchange="loadMem()"><option value="">All types</option><option>core</option><option>domain</option><option>project</option><option>episodic</option><option>semantic</option><option>skill</option></select>
    <select id="mtrust" onchange="loadMem()"><option value="">All trust</option><option>USER_CONFIRMED</option><option>SOURCE_VERIFIED</option><option>OBSERVED</option><option>INFERRED</option></select>
    <select id="mproj" onchange="loadMem()"><option value="">All projects</option></select>
    <select id="mtag" onchange="loadMem()"><option value="">All tags</option></select>
    <select id="mdomain" onchange="loadMem()"><option value="">All domains</option></select>
    <select id="mconf" onchange="loadMem()" title="Min confidence"><option value="">Any confidence</option><option value="0.8">≥ 0.8 (high)</option><option value="0.6">≥ 0.6 (medium+)</option><option value="0.0" data-max="0.4">≤ 0.4 (low)</option></select>
    <select id="mimportance" onchange="loadMem()" title="Min importance"><option value="">Any importance</option><option value="8">≥ 8 (high)</option><option value="6">≥ 6 (medium+)</option></select>
    <input id="mminw" type="number" min="1" placeholder="Min words" title="Minimum word count" style="width:80px;font-size:12px;background:#21262d;border:1px solid #30363d;color:#e6edf3;border-radius:4px;padding:2px 4px" onchange="loadMem()">
    <input id="mmaxw" type="number" min="1" placeholder="Max words" title="Maximum word count" style="width:80px;font-size:12px;background:#21262d;border:1px solid #30363d;color:#e6edf3;border-radius:4px;padding:2px 4px" onchange="loadMem()">
    <select id="mread" onchange="loadMem()" title="Reading time"><option value="">Any length</option><option value="quick">⚡ Quick (&lt;1 min)</option><option value="medium">📖 Medium (1-3 min)</option><option value="long">📚 Long (&gt;3 min)</option></select>
    <select id="mexp" onchange="loadMem()" title="Expiry filter"><option value="">Any expiry</option><option value="expired">⏰ Expired</option><option value="soon">⏳ Expiring soon (7d)</option><option value="any">📅 Has expiry</option></select>
    <select id="msort" onchange="loadMem()" title="Sort order"><option value="updated">Sort: Updated</option><option value="created">Sort: Created</option><option value="importance">Sort: Importance</option><option value="confidence">Sort: Confidence</option><option value="label">Sort: Label</option></select>
    <label style="display:flex;align-items:center;gap:4px;font-size:12px;color:#8b949e;white-space:nowrap"><input type="checkbox" id="mpinned" onchange="loadMem()"> Pinned only <span id="pinned-badge" style="display:none;background:#1f4b8e55;border:1px solid #58a6ff55;border-radius:10px;padding:0 6px;color:#58a6ff;font-size:11px;font-weight:600"></span></label>
    <label style="display:flex;align-items:center;gap:4px;font-size:12px;color:#d29922;white-space:nowrap"><input type="checkbox" id="mstarred" onchange="loadMem()"> ★ Starred only</label>
    <select id="mlabel" onchange="loadMem()"><option value="">All labels</option><option value="red">🔴 Red</option><option value="yellow">🟡 Yellow</option><option value="green">🟢 Green</option><option value="blue">🔵 Blue</option><option value="purple">🟣 Purple</option><option value="orange">🟠 Orange</option><option value="teal">🩵 Teal</option><option value="pink">🩷 Pink</option></select>
    <button class="btn" onclick="exportFilteredCsv()" title="Export current filter as CSV" style="font-size:12px">⬇ CSV</button>
    <button class="btn" id="arch-all-btn" onclick="archiveAllFiltered()" title="Archive ALL memories matching the current filter" style="font-size:12px;color:#f85149;border-color:#f8514966">⚠ archive all</button>
    <button class="btn" onclick="showAdd()" style="margin-left:auto">+ Add Memory</button>
  </div>
  <div id="mem-chips" style="display:none;padding:4px 0 8px;display:none;gap:6px;flex-wrap:wrap;align-items:center;font-size:12px"></div>
  <div id="bulk-bar" style="display:none;padding:8px 0;display:none;gap:10px;align-items:center;border-bottom:1px solid #30363d;margin-bottom:8px">
    <span id="bulk-count" style="color:#8b949e;font-size:13px"></span>
    <button class="btn" onclick="bulkArchive()">Archive selected</button>
    <select id="bulk-type" style="background:#161b22;color:#c9d1d9;border:1px solid #30363d;border-radius:6px;padding:4px 8px">
      <option value="">Change type…</option><option>core</option><option>domain</option><option>project</option><option>episodic</option><option>semantic</option><option>skill</option>
    </select>
    <button class="btn" onclick="bulkRetype()">Apply type</button>
    <span style="color:#30363d;margin:0 4px">|</span>
    <input id="bulk-tags" placeholder="tag1, tag2…" style="background:#161b22;color:#c9d1d9;border:1px solid #30363d;border-radius:6px;padding:4px 8px;width:140px">
    <button class="btn" onclick="bulkTagOp('add')" title="Add tags to selected">+ tags</button>
    <button class="btn" onclick="bulkTagOp('remove')" title="Remove tags from selected">− tags</button>
    <span style="color:#30363d;margin:0 4px">|</span>
    <select id="bulk-label" style="background:#161b22;color:#c9d1d9;border:1px solid #30363d;border-radius:6px;padding:4px 8px"><option value="">Label…</option><option value="red">🔴 Red</option><option value="yellow">🟡 Yellow</option><option value="green">🟢 Green</option><option value="blue">🔵 Blue</option><option value="purple">🟣 Purple</option><option value="orange">🟠 Orange</option><option value="teal">🩵 Teal</option><option value="pink">🩷 Pink</option><option value="__clear__">— Remove label</option></select>
    <button class="btn" onclick="bulkLabel()" title="Apply label to selected">Apply label</button>
    <button class="btn" id="bulk-merge-btn" onclick="showMerge()" style="display:none" title="Merge two selected memories">⟳ Merge</button>
    <button class="btn" onclick="exportSelectionCsv()" title="Export selected as CSV">⬇ CSV</button>
    <button class="arch" onclick="clearSelection()" style="margin-left:auto">✕ clear</button>
  </div>
  <div id="ml"></div>
  <div id="mem-more" style="display:none;padding:12px 0;text-align:center">
    <button class="btn" onclick="loadMoreMem()" id="mem-more-btn">Load more</button>
    <span id="mem-count" style="font-size:12px;color:#8b949e;margin-left:10px"></span>
  </div>
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

<div id="digest" class="tab">
  <div class="row" style="margin-bottom:16px;gap:8px">
    <button class="btn" onclick="loadDigest('daily')" id="dg-daily">Daily</button>
    <button class="btn" onclick="loadDigest('weekly')" id="dg-weekly">Weekly</button>
  </div>
  <div id="dg-body"><p class="empty">Loading…</p></div>
</div>

<div id="decay" class="tab">
  <div class="row" style="margin-bottom:16px;gap:8px">
    <button class="btn" onclick="loadDecayPreview()">↺ Preview decay</button>
    <button class="btn" style="color:#f85149" onclick="runDecay()">▶ Apply decay</button>
  </div>
  <p style="font-size:12px;color:#8b949e;margin:0 0 16px">Confidence decays at ~1%/week for memories idle &gt;14 days (0.5%/week for pinned or high-importance). Floor: 10%.</p>
  <div id="dc-body"><p class="empty">Click "Preview decay" to see which memories would decay.</p></div>
</div>

<div id="conflicts" class="tab">
  <div class="row" style="margin-bottom:16px"><button class="btn" onclick="loadConflicts()">↺ Refresh</button></div>
  <div id="cf-body"><p class="empty">Loading…</p></div>
</div>

<div id="memgraph" class="tab" style="padding:0">
  <div style="padding:12px 24px;display:flex;gap:8px;align-items:center;border-bottom:1px solid #21262d">
    <button class="btn" onclick="loadMemGraph()">↺ Refresh</button>
    <span id="mg-stats" style="font-size:12px;color:#8b949e"></span>
  </div>
  <canvas id="mg-canvas" style="width:100%;display:block;background:#0d1117"></canvas>
</div>

<div id="timeline" class="tab">
  <div class="row" style="gap:8px;flex-wrap:wrap">
    <select id="tl-days" onchange="loadTimeline()">
      <option value="14">Last 14 days</option>
      <option value="30" selected>Last 30 days</option>
      <option value="60">Last 60 days</option>
      <option value="90">Last 90 days</option>
    </select>
    <select id="tl-gran" onchange="loadTimeline()">
      <option value="day">Daily</option>
      <option value="week">Weekly</option>
    </select>
    <select id="tl-type" onchange="loadTimeline()">
      <option value="">All types</option>
      <option>core</option><option>domain</option><option>project</option>
      <option>episodic</option><option>semantic</option><option>skill</option>
    </select>
    <span id="tl-summary" style="font-size:12px;color:#8b949e;margin-left:8px"></span>
  </div>
  <div id="tl-chart" style="margin:8px 0 20px"></div>
  <div id="tl-detail"></div>
</div>

<div id="clusters" class="tab">
  <div class="row" style="gap:8px">
    <select id="cl-min" onchange="loadClusters()">
      <option value="2" selected>Min 2 shared tags</option>
      <option value="3">Min 3 shared tags</option>
      <option value="1">Min 1 shared tag</option>
    </select>
    <span id="cl-summary" style="font-size:12px;color:#8b949e;margin-left:8px"></span>
  </div>
  <div id="cl-list" style="margin-top:16px"></div>
</div>

<div id="reminders" class="tab">
  <div class="row" style="gap:8px">
    <select id="rem-urgency" onchange="loadReminders()">
      <option value="">All urgencies</option>
      <option value="critical">Critical</option>
      <option value="high">High</option>
      <option value="medium">Medium</option>
      <option value="low">Low</option>
    </select>
    <span id="rem-summary" style="font-size:12px;color:#8b949e;margin-left:8px"></span>
  </div>
  <div id="rem-list" style="margin-top:16px"></div>
</div>

<div id="compare" class="tab">
  <div class="row" style="gap:8px;align-items:flex-end">
    <div style="flex:1">
      <div style="font-size:11px;color:#8b949e;margin-bottom:4px">Memory A</div>
      <input id="cmp-a" placeholder="Search memory A…" oninput="cmpSearch('a')" autocomplete="off" style="width:100%">
      <div id="cmp-a-list" style="position:relative"></div>
    </div>
    <div style="flex:1">
      <div style="font-size:11px;color:#8b949e;margin-bottom:4px">Memory B</div>
      <input id="cmp-b" placeholder="Search memory B…" oninput="cmpSearch('b')" autocomplete="off" style="width:100%">
      <div id="cmp-b-list" style="position:relative"></div>
    </div>
    <button class="btn" onclick="runCompare()">Compare →</button>
  </div>
  <div id="cmp-out" style="margin-top:20px"></div>
</div>

<div id="gaps" class="tab">
  <div class="row" style="gap:8px;align-items:center">
    <button class="btn" onclick="loadGaps()">↺ Refresh</button>
    <label style="font-size:12px;color:#8b949e">Min confidence threshold:
      <input id="gap-conf" type="number" min="0" max="1" step="0.1" value="0.5" style="width:60px;margin-left:4px">
    </label>
    <label style="font-size:12px;color:#8b949e">Min importance (critical):
      <input id="gap-imp" type="number" min="1" max="10" step="1" value="7" style="width:50px;margin-left:4px">
    </label>
    <span id="gap-summary" style="font-size:12px;color:#8b949e;margin-left:8px"></span>
  </div>
  <div id="gap-list" style="margin-top:16px"></div>
</div>

<div id="health" class="tab">
  <div class="row" style="gap:8px;align-items:center;margin-bottom:12px">
    <button class="btn" onclick="loadHealth()">↺ Refresh</button>
    <select id="hlt-grade" onchange="loadHealth()" style="background:#161b22;color:#c9d1d9;border:1px solid #30363d;border-radius:6px;padding:5px 8px;font-size:12px">
      <option value="">All grades</option>
      <option value="poor">Poor only</option>
      <option value="fair">Fair only</option>
      <option value="good">Good only</option>
    </select>
    <select id="hlt-sort" onchange="loadHealth()" style="background:#161b22;color:#c9d1d9;border:1px solid #30363d;border-radius:6px;padding:5px 8px;font-size:12px">
      <option value="asc">Worst first (triage)</option>
      <option value="desc">Best first</option>
    </select>
    <span id="hlt-summary" style="font-size:12px;color:#8b949e;margin-left:4px"></span>
  </div>
  <div id="hlt-list"></div>
</div>

<div id="calibrate" class="tab">
  <div class="row" style="gap:8px;align-items:center;margin-bottom:4px">
    <button class="btn" onclick="loadCalibrate()">↺ Preview</button>
    <button class="btn" id="cal-apply-btn" style="display:none;background:#238636;border-color:#238636" onclick="applyCalibrate()">Apply changes</button>
    <span id="cal-summary" style="font-size:12px;color:#8b949e;margin-left:4px"></span>
  </div>
  <p style="font-size:12px;color:#8b949e;margin-bottom:12px">Recalculates confidence based on trust-level ceiling and age decay. No effect on USER_CONFIRMED memories.</p>
  <div id="cal-list"></div>
</div>

<div id="import" class="tab">
  <h3 style="margin:0 0 12px;font-size:14px;color:#e6edf3">Batch Markdown Import</h3>
  <p style="font-size:12px;color:#8b949e;margin-bottom:12px">Import all <code>.md</code> files in a directory. Files already imported are skipped (deduplicated by path).</p>
  <div class="row" style="gap:8px;align-items:center;margin-bottom:12px">
    <input id="imp-path" placeholder="Directory path, e.g. C:\\notes or /home/user/notes" style="flex:1;min-width:0">
    <button class="btn" onclick="importPreview()">🔍 Preview</button>
    <button class="btn" id="imp-go-btn" style="display:none;background:#238636;border-color:#238636" onclick="importAll()">⬆ Import All</button>
  </div>
  <div id="imp-status" style="font-size:12px;color:#8b949e;margin-bottom:8px"></div>
  <div id="imp-list"></div>
</div>

<div id="tagcloud" class="tab">
  <div class="row" style="margin-bottom:12px;gap:8px;align-items:center">
    <button class="btn" onclick="loadTagCloud()">↺ Refresh</button>
    <input id="tc-co" placeholder="Co-occurrence for tag…" style="width:200px" oninput="loadCoOccurrence()">
    <span id="tc-active-tag" style="display:none;font-size:12px;color:#79c0ff">
      Filtering: <b id="tc-active-label"></b>
      <button onclick="renameTagGlobal()" style="background:none;border:none;color:#58a6ff;cursor:pointer;font-size:12px;margin-left:8px" title="Rename this tag across all memories">✎ rename</button>
      <button onclick="mergeTagGlobal()" style="background:none;border:none;color:#3fb950;cursor:pointer;font-size:12px;margin-left:4px" title="Merge this tag into another tag">⟳ merge into…</button>
      <button onclick="clearTagFilter()" style="background:none;border:none;color:#8b949e;cursor:pointer;font-size:12px;margin-left:4px">✕ clear</button>
    </span>
  </div>
  <div id="tc-cloud" style="line-height:2.4;padding:8px 0"></div>
  <div id="tc-top" style="margin-top:16px"></div>
  <div id="tc-co-out" style="margin-top:16px;display:none">
    <h4 style="margin:0 0 8px;font-size:13px;color:#8b949e">Co-occurring tags</h4>
    <div id="tc-co-list"></div>
  </div>
  <div id="tc-results" style="margin-top:20px;display:none">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
      <h4 id="tc-results-title" style="margin:0;font-size:13px;color:#8b949e"></h4>
      <a id="tc-results-browse" href="#" style="font-size:12px;color:#58a6ff" onclick="browseTag(event)">Browse in Memories →</a>
    </div>
    <div id="tc-heatmap" style="margin-top:14px"></div>
    <div id="tc-results-list"></div>
  </div>
</div>

<div id="merge-modal" class="modal" onclick="if(event.target===this)closeMerge()">
  <div class="mbox" style="max-width:720px">
    <h3 style="margin-bottom:8px">Merge Memories</h3>
    <p style="color:#8b949e;font-size:12px;margin-bottom:16px">Title and content from <b style="color:#3fb950">Keep</b> are preserved. Tags from both are combined. The discarded memory is archived.</p>
    <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:12px;align-items:start">
      <div>
        <div style="font-size:11px;color:#3fb950;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Keep</div>
        <div id="mg-keep" style="background:#0d1117;border:1px solid #3fb950;border-radius:6px;padding:10px;font-size:13px;min-height:80px"></div>
      </div>
      <div style="display:flex;align-items:center;padding-top:22px">
        <button class="btn" onclick="swapMerge()" title="Swap keep / discard" style="padding:6px 10px">⇄</button>
      </div>
      <div>
        <div style="font-size:11px;color:#f85149;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Discard</div>
        <div id="mg-discard" style="background:#0d1117;border:1px solid #f85149;border-radius:6px;padding:10px;font-size:13px;min-height:80px"></div>
      </div>
    </div>
    <div id="mg-tags" style="margin-top:12px;font-size:12px;color:#8b949e;min-height:20px"></div>
    <div id="mg-err" style="color:#f85149;font-size:12px;margin-top:8px"></div>
    <div style="display:flex;gap:8px;margin-top:16px">
      <button class="btn" onclick="confirmMerge()">Confirm Merge</button>
      <button class="arch" onclick="closeMerge()">Cancel</button>
    </div>
  </div>
</div>
<div id="link-modal" class="modal" onclick="if(event.target===this)this.style.display='none'">
  <div class="mbox" style="max-width:620px">
    <h3>Memory Links</h3>
    <div id="lk-list" style="margin-bottom:16px"></div>
    <div style="border-top:1px solid #21262d;padding-top:12px">
      <h4 style="margin:0 0 8px;font-size:13px;color:#8b949e">Add link</h4>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <select id="lk-type" style="background:#161b22;color:#c9d1d9;border:1px solid #30363d;border-radius:6px;padding:6px 8px">
          <option>related</option><option>supports</option><option>contradicts</option><option>supersedes</option><option>predecessor</option><option>see-also</option>
        </select>
        <input id="lk-to" placeholder="Target memory ID" style="flex:1;min-width:200px">
        <input id="lk-notes" placeholder="Notes (optional)" style="flex:1;min-width:160px">
        <button class="btn" onclick="addLink()">Link</button>
      </div>
      <p id="lk-err" style="color:#f85149;font-size:12px;margin:6px 0 0"></p>
    </div>
    <div class="mbtns"><button class="btn" onclick="g('link-modal').style.display='none'">Close</button></div>
  </div>
</div>

<div id="hist-modal" class="modal" onclick="if(event.target===this)this.style.display='none'">
  <div class="mbox" style="max-width:900px;max-height:88vh;overflow-y:auto">
    <h3>Version History</h3>
    <div id="hist-list"></div>
    <div id="hist-diff" style="display:none;margin-top:12px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <h4 style="margin:0;font-size:13px;color:#8b949e">Side-by-side diff (snapshot → current)</h4>
        <button class="btn" id="hist-diff-toggle" style="font-size:11px;padding:2px 8px" onclick="toggleDiffMode()">Switch to unified</button>
      </div>
      <div id="hist-diff-out" style="font-size:12px;overflow-x:auto"></div>
    </div>
    <div class="mbtns"><button class="btn" onclick="g('hist-modal').style.display='none'">Close</button></div>
  </div>
</div>

<div id="share-modal" class="modal" onclick="if(event.target===this)this.classList.remove('on')">
  <div class="mbox" style="max-width:560px">
    <h3>Share Memory</h3>
    <textarea id="share-ta" rows="12" style="width:100%;background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:6px;padding:8px;font-size:12px;font-family:monospace;resize:vertical" readonly></textarea>
    <div class="mbtns" style="margin-top:10px">
      <button class="btn" id="share-copy-btn" onclick="shareCardCopy()">📋 Copy</button>
      <button class="btn" onclick="g('share-modal').classList.remove('on')">Close</button>
    </div>
  </div>
</div>

<div id="add-modal" class="modal">
  <div class="mbox">
    <h3 id="nm-h">Add Memory</h3>
    <div class="f" id="nm-tpl-row" style="display:none"><label style="margin-bottom:4px">Template</label><div id="nm-tpl-chips" style="display:flex;flex-wrap:wrap;gap:4px"></div></div>
    <div class="f"><label>Title *</label><input id="nm-t" style="width:100%" placeholder="Memory title"></div>
    <div class="f"><label>Content *</label><textarea id="nm-c" rows="5" placeholder="Memory content…"></textarea></div>
    <div class="f"><label>Type</label><select id="nm-ty" onchange="applyTemplate(this.value)"><option>semantic</option><option>core</option><option>domain</option><option>project</option><option>episodic</option><option>skill</option></select></div>
    <div class="f"><label>Trust</label><select id="nm-tr"><option>OBSERVED</option><option>USER_CONFIRMED</option><option>SOURCE_VERIFIED</option><option>INFERRED</option></select></div>
    <div class="f"><label>Importance (1–10)</label><input id="nm-i" type="number" min="1" max="10" value="5"></div>
    <div class="f"><label>Confidence (0–1) <span style="font-weight:normal;color:#8b949e">how certain this is</span></label><input id="nm-cf" type="number" min="0" max="1" step="0.05" value="0.5" style="width:88px"></div>
    <div class="f"><label>Tags <span style="font-weight:normal;color:#8b949e">(comma-separated)</span></label><div style="position:relative"><input id="nm-tg" style="width:100%" placeholder="e.g. javascript, async, todo" oninput="tagSuggest(this)" onkeydown="tagSuggestKey(event)" onblur="setTimeout(()=>{const s=g('nm-tg-sug');if(s)s.style.display='none'},150)" autocomplete="off"><div id="nm-tg-sug" style="display:none;position:absolute;top:100%;left:0;right:0;background:#161b22;border:1px solid #30363d;border-radius:6px;z-index:200;max-height:180px;overflow-y:auto;box-shadow:0 4px 12px rgba(0,0,0,.5)"></div></div></div>
    <div class="f"><label>Note <span style="font-weight:normal;color:#8b949e">(optional sticky comment)</span></label><textarea id="nm-nt" rows="2" placeholder="Short note or reminder about this memory…" style="width:100%"></textarea></div>
    <div class="f"><label>Expiry date <span style="font-weight:normal;color:#8b949e">(optional — shows expired badge after this date)</span></label><input id="nm-ex" type="date" style="width:180px"></div>
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
function age(ts) {
  const s = (Date.now() - ts) / 1000;
  if (s < 3600)      return Math.max(1, Math.round(s/60)) + 'min';
  if (s < 86400)     return Math.round(s/3600) + 'h';
  if (s < 7*86400)   return Math.round(s/86400) + 'd';
  if (s < 30*86400)  return Math.round(s/(7*86400)) + 'w';
  if (s < 365*86400) return Math.round(s/(30*86400)) + 'm';
  return Math.round(s/(365*86400)) + 'y';
}

function show(id, btn) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('on'));
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('on'));
  g(id).classList.add('on'); btn.classList.add('on');
  if (id==='search') loadBookmarks();
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

// Escape HTML then promote \x01...\x02 control-char markers to <mark> tags.
// This is XSS-safe: esc() runs first, then we insert known-safe <mark> from fixed pattern.
function hlEsc(s) {
  if (!s) return '';
  return esc(s).replace(/\x01([^\x02]*)\x02/g, '<mark style="background:#2d4a1e;color:#7ee787;border-radius:2px;padding:0 2px">$1</mark>');
}

function confBar(c) {
  const pct = Math.round((c||0.5)*100);
  const col = c >= 0.8 ? '#3fb950' : c >= 0.5 ? '#d29922' : '#f85149';
  return \`<span title="confidence \${pct}%" style="font-size:11px;color:\${col};margin-right:4px">▸\${pct}%<span class="cbar" style="width:\${pct/2}px;background:\${col}"></span></span>\`;
}
function card(m) {
  const preview = (m.content||'').replace(/\\n/g,' ').slice(0,280);
  const _activeTg = g('mtag').value;
  const tags = (m.tags||[]).map(t=>{const on=t===_activeTg;return \`<span style="display:inline-flex;align-items:center;gap:1px"><span class="b" style="cursor:pointer;\${on?'color:#3fb950;background:#1f4b2b;border-radius:3px;padding:0 3px':'color:#79c0ff'}" title="\${on?'Clear':'Filter by'} #\${esc(t)} · dblclick to rename" onclick="filterTag('\${esc(t)}')" ondblclick="event.stopPropagation();renameTagInline('\${m.id}','\${esc(t)}',this)">#\${esc(t)}</span><span style="cursor:pointer;color:#484f58;font-size:9px;padding:0 1px" onmouseenter="this.style.color='#f85149'" onmouseleave="this.style.color='#484f58'" onclick="event.stopPropagation();removeTag('\${m.id}','\${esc(t)}')" title="Remove tag">✕</span></span>\`;}).join(' ');
  const LCOL = {red:'#f85149',yellow:'#d29922',green:'#3fb950',blue:'#58a6ff',purple:'#d2a8ff',orange:'#ffa657',teal:'#39c5cf',pink:'#f778ba'};
  const pinStyle = m.pinned ? 'border-left:3px solid #d29922;' : (m.label ? \`border-left:3px solid \${LCOL[m.label]};\` : '');
  const pinBtn = m.pinned
    ? \`<button class="arch" style="color:#d29922" onclick="togglePin('\${m.id}',0)" title="Unpin">📌 pinned</button>\`
    : \`<button class="arch" onclick="togglePin('\${m.id}',1)" title="Pin">📌 pin</button>\`;
  const starBtn = m.starred
    ? \`<button class="arch" style="color:#d29922" onclick="toggleStar('\${m.id}',0)" title="Unstar">★ starred</button>\`
    : \`<button class="arch" onclick="toggleStar('\${m.id}',1)" title="Star this memory">☆ star</button>\`;
  const words = (m.content||'').trim().split(/\s+/).filter(Boolean).length;
  const rt = Math.max(1, Math.ceil(words / 200));
  const ageStr = age(m.created_at);
  const labelSel = \`<select class="arch" style="font-size:11px;padding:0 2px;cursor:pointer;background:#21262d;color:\${m.label?LCOL[m.label]:'#8b949e'};border:1px solid #30363d;border-radius:3px" title="Color label" onchange="setLabel('\${m.id}',this.value)"><option value="">🏷 label</option><option value="red"\${m.label==='red'?' selected':''}>🔴 red</option><option value="yellow"\${m.label==='yellow'?' selected':''}>🟡 yellow</option><option value="green"\${m.label==='green'?' selected':''}>🟢 green</option><option value="blue"\${m.label==='blue'?' selected':''}>🔵 blue</option><option value="purple"\${m.label==='purple'?' selected':''}>🟣 purple</option><option value="orange"\${m.label==='orange'?' selected':''}>🟠 orange</option><option value="teal"\${m.label==='teal'?' selected':''}>🩵 teal</option><option value="pink"\${m.label==='pink'?' selected':''}>🩷 pink</option></select>\`;
  const labelDot = m.label ? \`<span style="color:\${LCOL[m.label]};font-size:14px;margin-right:4px" title="Label: \${m.label}">●</span>\` : '';
  const expiredBadge = m.expires_at && m.expires_at < Date.now() ? \`<span class="b" style="color:#f85149;border-color:#f85149" title="Expired \${new Date(m.expires_at).toLocaleDateString()}">⏰ expired</span>\` : (m.expires_at ? \`<span class="b" style="color:#d29922;border-color:#d29922" title="Expires \${new Date(m.expires_at).toLocaleDateString()}">⏳ exp \${new Date(m.expires_at).toLocaleDateString()}</span>\` : '');
  return \`<div class="card" data-id="\${m.id}" style="\${pinStyle}">
    <div class="ct"><input type="checkbox" style="margin-right:8px;cursor:pointer" onchange="toggleSel('\${m.id}',this.checked)"><span class="ct-title" ondblclick="inlineEdit('\${m.id}')" title="Double-click to edit inline" style="cursor:text">\${esc(m.title)}</span><button class="arch" onclick="archiveMem('\${m.id}',this)" title="Archive">× archive</button><button class="arch" id="cl-\${m.id}" onclick="copyLink('\${m.id}')" title="Copy link to this memory">🔗 copy</button><button class="arch" onclick="shareCard('\${m.id}')" title="Share this memory as a text card">📤 share</button><button class="arch" onclick="showEdit('\${m.id}')" title="Edit">✎ edit</button><button class="arch" onclick="duplicateMem('\${m.id}')" title="Duplicate">⧉ dupe</button><button class="arch" onclick="showHistory('\${m.id}')" title="History">⏱ history</button><button class="arch" onclick="showLinks('\${m.id}')" title="Links">⇄ links</button>\${pinBtn}\${starBtn}<button class="arch" onclick="toggleRelated('\${m.id}')" title="Show related memories">~ related</button><select class="arch" style="font-size:11px;padding:0 2px;cursor:pointer;background:#21262d;color:#8b949e;border:1px solid #30363d;border-radius:3px" title="Apply template" onchange="applyTemplate('\${m.id}',this.value);this.value=''"><option value="">⊞ tpl</option><option value="core">core</option><option value="skill">skill</option><option value="domain">domain</option><option value="project">project</option><option value="episodic">episodic</option><option value="semantic">semantic</option></select>\${labelSel}</div>
    <div class="cm">\${labelDot}\${confBar(m.confidence)}<span class="b bt">\${m.memory_type}</span><span class="b br">\${m.trust_level}</span><span class="b bi">i=\${m.importance}</span><span class="b" style="color:#8b949e" title="\${words} words">\${words}w \${rt}m</span><span class="b" style="color:#8b949e" title="Created \${new Date(m.created_at).toLocaleDateString()}">\${ageStr}</span>\${expiredBadge}\${tags}</div>
    <div class="cc" ondblclick="inlineEdit('\${m.id}')" title="Double-click to edit inline" style="cursor:text">\${esc(preview)}\${m.content.length>280?'…':''}</div>
    \${m.note ? \`<div style="margin-top:6px;padding:5px 8px;background:#1c2128;border-left:2px solid #d29922;border-radius:0 4px 4px 0;font-size:12px;color:#c9a227;cursor:pointer" title="Click to edit note" onclick="editNote('\${m.id}',this)">\${esc(m.note)}</div>\` : \`<div style="margin-top:4px"><button class="arch" style="font-size:11px;color:#484f58" onclick="editNote('\${m.id}',this.parentElement)" title="Add a sticky note">📝 add note</button></div>\`}
    <div id="rel-\${m.id}" style="display:none;margin-top:8px;border-top:1px solid #21262d;padding-top:8px"></div>
  </div>\`;
}

function searchCard(m) {
  const titleHtml  = m.highlight_title ? hlEsc(m.highlight_title) : esc(m.title);
  const snippetHtml = m.snippet        ? hlEsc(m.snippet)         : esc((m.content||'').replace(/\\n/g,' ').slice(0, 280));
  const tags = (m.tags||[]).map(t=>\`<span style="display:inline-flex;align-items:center;gap:1px"><span class="b" style="cursor:pointer;color:#79c0ff" title="Filter by #\${esc(t)} · dblclick to rename" onclick="filterTag('\${esc(t)}')" ondblclick="event.stopPropagation();renameTagInline('\${m.id}','\${esc(t)}',this)">#\${esc(t)}</span><span style="cursor:pointer;color:#484f58;font-size:9px;padding:0 1px" onmouseenter="this.style.color='#f85149'" onmouseleave="this.style.color='#484f58'" onclick="event.stopPropagation();removeTag('\${m.id}','\${esc(t)}')" title="Remove tag">✕</span></span>\`).join(' ');
  const words = (m.content||'').trim().split(/\s+/).filter(Boolean).length;
  const rt = Math.max(1, Math.ceil(words / 200));
  const ageStr = age(m.created_at);
  return \`<div class="card" data-id="\${m.id}">
    <div class="ct">\${titleHtml}
      <button class="arch" onclick="archiveMem('\${m.id}',this)" title="Archive">× archive</button>
    </div>
    <div class="cm">\${confBar(m.confidence)}<span class="b bt">\${m.memory_type}</span><span class="b br">\${m.trust_level}</span><span class="b bi">i=\${m.importance}</span><span class="b" style="color:#8b949e" title="\${words} words">\${words}w \${rt}m</span><span class="b" style="color:#8b949e" title="Created \${new Date(m.created_at).toLocaleDateString()}">\${ageStr}</span>\${tags}</div>
    <div class="cc">\${snippetHtml}</div>
  </div>\`;
}

async function loadBookmarks() {
  const bs = await api('/api/bookmarks');
  const bar = g('bk-bar'), chips = g('bk-chips');
  if (!bs.length) { bar.style.display='none'; return; }
  bar.style.display='block';
  chips.innerHTML = bs.map(b => \`<span style="display:inline-flex;align-items:center;gap:4px;background:#21262d;border-radius:12px;padding:2px 10px;margin:2px;cursor:pointer" onclick="runBookmark('\${esc(b.query)}','\${b.mode}')" title="\${esc(b.query)} [\${b.mode}]">\${esc(b.name)}<span onclick="event.stopPropagation();deleteBookmark(\${b.id})" style="color:#8b949e;margin-left:4px;cursor:pointer">×</span></span>\`).join('');
}
async function saveBookmark() {
  const q = g('q').value.trim();
  if (!q) { alert('Enter a search query first.'); return; }
  const name = prompt('Bookmark name:');
  if (!name) return;
  const mode = g('smode').value;
  const r = await localFetch('/api/bookmarks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,query:q,mode})});
  const d = await r.json();
  if (d.error) { alert(d.error); return; }
  loadBookmarks();
}
function runBookmark(q, mode) {
  g('q').value = q; g('smode').value = mode; doSearch();
}
async function deleteBookmark(id) {
  await localFetch('/api/bookmarks/'+id,{method:'DELETE'});
  loadBookmarks();
}
async function doSearch() {
  const q = g('q').value.trim();
  if (!q) return;
  const mode = g('smode').value;
  const notesOnly = g('snotes').checked ? '&notes_only=1' : '';
  const d = await api('/api/search?q='+encodeURIComponent(q)+'&limit=20&mode='+mode+notesOnly);
  _srResults = d;
  g('sr').innerHTML = d.length ? d.map(searchCard).join('') : '<p class="empty">No results.</p>';
  const csvBtn = g('sr-csv-btn'); if (csvBtn) csvBtn.style.display = d.length ? '' : 'none';
  const cntEl = g('sr-count'); if (cntEl) cntEl.textContent = d.length ? d.length + (d.length === 20 ? '+ results' : ' result' + (d.length === 1 ? '' : 's')) : '';
  loadHistory();
}
function exportSearchCsv() {
  if (!_srResults.length) return;
  const url = '/api/export?format=csv&ids=' + _srResults.map(m => encodeURIComponent(m.id)).join(',');
  const a = document.createElement('a'); a.href = url; a.download = 'hive-search.csv'; a.click();
}

var _sugTimer = null, _sugIdx = -1;
function suggestDebounce(v) {
  clearTimeout(_sugTimer);
  if (!v || v.length < 2) { hideSuggest(); return; }
  _sugTimer = setTimeout(function() { runSuggest(v); }, 150);
}
async function runSuggest(v) {
  var items = await api('/api/search/suggest?q=' + encodeURIComponent(v));
  if (!items || !items.length) { hideSuggest(); return; }
  showSuggest(items);
}
function showSuggest(items) {
  var el = g('srch-sug');
  el.innerHTML = items.map(function(it) {
    var cls = it.type === 'tag' ? 'ss-type tag' : 'ss-type';
    var lbl = it.type === 'tag' ? '#tag' : 'memory';
    return '<div class="ss-item" data-label="' + esc(it.label) + '" onclick="pickSuggest(this)">'
      + '<span class="' + cls + '">' + lbl + '</span>'
      + '<span style="overflow:hidden;text-overflow:ellipsis">' + esc(it.label) + '</span>'
      + '</div>';
  }).join('');
  _sugIdx = -1;
  var r = g('q').getBoundingClientRect();
  el.style.top = (r.bottom + 2) + 'px';
  el.style.left = r.left + 'px';
  el.style.width = Math.max(r.width, 260) + 'px';
  el.style.display = 'block';
}
function hideSuggest() {
  var el = g('srch-sug');
  if (el) { el.style.display = 'none'; el.innerHTML = ''; _sugIdx = -1; }
}
function pickSuggest(el) {
  g('q').value = el.dataset.label;
  hideSuggest();
  doSearch();
}
function suggestNav(e) {
  var items = document.querySelectorAll('#srch-sug .ss-item');
  if (!items.length) return;
  e.preventDefault();
  if (e.key === 'ArrowDown') _sugIdx = Math.min(_sugIdx + 1, items.length - 1);
  else _sugIdx = Math.max(_sugIdx - 1, -1);
  items.forEach(function(el, i) { el.classList.toggle('on', i === _sugIdx); });
  if (_sugIdx >= 0) g('q').value = items[_sugIdx].dataset.label;
}
document.addEventListener('click', function(e) {
  if (e.target.id !== 'q' && !g('srch-sug').contains(e.target)) hideSuggest();
});

let _sel = new Set();
let _srResults = [];
function toggleSel(id, on) {
  on ? _sel.add(id) : _sel.delete(id);
  const bar = g('bulk-bar');
  if (_sel.size) { bar.style.display='flex'; g('bulk-count').textContent=_sel.size+' selected'; }
  else { bar.style.display='none'; }
  const mb = g('bulk-merge-btn');
  if (mb) mb.style.display = _sel.size === 2 ? '' : 'none';
}
function clearSelection() {
  _sel.clear();
  g('bulk-bar').style.display='none';
  const mb = g('bulk-merge-btn'); if (mb) mb.style.display='none';
  document.querySelectorAll('#ml input[type=checkbox]').forEach(cb => cb.checked=false);
}
var _mgKeep = null, _mgDiscard = null;
function showMerge() {
  if (_sel.size !== 2) return;
  var ids = [..._sel]; _mgKeep = ids[0]; _mgDiscard = ids[1];
  g('mg-err').textContent = '';
  renderMergeModal();
  g('merge-modal').style.display = 'flex';
}
async function renderMergeModal() {
  var k = await api('/api/memories/' + _mgKeep);
  var d = await api('/api/memories/' + _mgDiscard);
  g('mg-keep').innerHTML = '<b style="color:#e6edf3">' + esc(k.title) + '</b>'
    + '<div style="color:#8b949e;margin-top:4px;font-size:12px">' + esc((k.content||'').slice(0,120)) + ((k.content||'').length>120?'…':'') + '</div>';
  g('mg-discard').innerHTML = '<b style="color:#e6edf3">' + esc(d.title) + '</b>'
    + '<div style="color:#8b949e;margin-top:4px;font-size:12px">' + esc((d.content||'').slice(0,120)) + ((d.content||'').length>120?'…':'') + '</div>';
  var allTags = [...new Set([...(k.tags||[]), ...(d.tags||[])])];
  g('mg-tags').innerHTML = allTags.length
    ? 'Combined tags: ' + allTags.map(t => '<span style="background:#21262d;border-radius:3px;padding:1px 6px;margin-right:4px;font-size:11px">' + esc(t) + '</span>').join('')
    : '<span style="color:#484f58">No tags on either memory</span>';
}
function swapMerge() { var tmp=_mgKeep; _mgKeep=_mgDiscard; _mgDiscard=tmp; renderMergeModal(); }
function closeMerge() { g('merge-modal').style.display='none'; }
async function confirmMerge() {
  g('mg-err').textContent = '';
  const r = await localFetch('/api/memories/merge', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ keep: _mgKeep, discard: _mgDiscard })
  });
  if (!r.ok) { const e = await r.json(); g('mg-err').textContent = e.error || 'Merge failed'; return; }
  closeMerge(); _sel.clear(); g('bulk-bar').style.display='none';
  const mb = g('bulk-merge-btn'); if (mb) mb.style.display='none';
  loadMem(); refreshStats();
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
async function bulkTagOp(op) {
  if (!_sel.size) return;
  const raw = (g('bulk-tags').value || '').split(',').map(t => t.trim()).filter(Boolean);
  if (!raw.length) { g('bulk-tags').style.borderColor='#f85149'; return; }
  g('bulk-tags').style.borderColor='';
  const action = op === 'add' ? 'add_tags' : 'remove_tags';
  await fetch('/api/memories/bulk', {
    method: 'POST',
    headers: {'Content-Type':'application/json','X-Hive-Local':'1'},
    body: JSON.stringify({ ids: [..._sel], action: action, updates: { tags: raw } })
  });
  _sel.clear(); loadMem();
  g('bulk-bar').style.display='none'; g('bulk-tags').value='';
}
async function bulkLabel() {
  const lbl = g('bulk-label').value;
  if (!lbl || !_sel.size) return;
  const label = lbl === '__clear__' ? null : lbl;
  await fetch('/api/memories/bulk',{method:'POST',headers:{'Content-Type':'application/json','X-Hive-Local':'1'},
    body:JSON.stringify({ids:[..._sel],action:'update',updates:{label}})});
  _sel.clear(); loadMem();
  g('bulk-bar').style.display='none'; g('bulk-label').value='';
}

let _domainsLoaded = false;
let _memOffset = 0;
const _MEM_PAGE = 50;

function _memUrl(offset) {
  let u = \`/api/memories?limit=\${_MEM_PAGE}&offset=\${offset}\`;
  const t=g('mtype').value, r=g('mtrust').value, p=g('mproj').value, tg=g('mtag').value;
  const dom=g('mdomain').value, imp=g('mimportance').value, sort=g('msort').value;
  const confOpt = g('mconf').selectedOptions[0];
  const minC = confOpt ? confOpt.value : '';
  const maxC = confOpt ? (confOpt.dataset.max||'') : '';
  if (t) u += '&type='+t; if (r) u += '&trust='+r; if (p) u += '&project='+p; if (tg) u += '&tag='+encodeURIComponent(tg);
  if (dom) u += '&domain='+encodeURIComponent(dom);
  if (minC !== '') u += '&min_conf='+minC; if (maxC !== '') u += '&max_conf='+maxC;
  if (imp) u += '&min_importance='+imp;
  if (sort && sort !== 'updated') u += '&sort='+sort;
  if (g('mpinned').checked)  u += '&pinned=1';
  if (g('mstarred').checked) u += '&starred=1';
  const lbl = g('mlabel').value; if (lbl) u += '&label='+encodeURIComponent(lbl);
  const minw=g('mminw').value, maxw=g('mmaxw').value;
  if (minw) u += '&min_words='+minw; if (maxw) u += '&max_words='+maxw;
  const rdt=g('mread').value; if (rdt) u += '&read_time='+rdt;
  const exp=g('mexp').value; if (exp) u += '&expires='+exp;
  return u;
}

async function loadMem() {
  _memOffset = 0;
  _sel.clear(); g('bulk-bar').style.display='none';
  if (!_domainsLoaded) {
    _domainsLoaded = true;
    try {
      const doms = await api('/api/domains');
      const sel = g('mdomain');
      sel.innerHTML = '<option value="">All domains</option>' + doms.map(d=>\`<option>\${esc(d)}</option>\`).join('');
    } catch {}
  }
  const t=g('mtype').value, r=g('mtrust').value, tg=g('mtag').value;
  const dom=g('mdomain').value, imp=g('mimportance').value, sort=g('msort').value;
  const chips = [];
  if (t) chips.push([t,'mtype']);
  if (r) chips.push([r,'mtrust']);
  if (tg) chips.push(['tag:'+tg,'mtag']);
  if (dom) chips.push(['domain:'+dom,'mdomain']);
  if (imp) chips.push(['importance≥'+imp,'mimportance']);
  if (sort && sort !== 'updated') chips.push(['sort:'+sort,'msort']);
  if (g('mpinned').checked)  chips.push(['pinned','mpinned']);
  if (g('mstarred').checked) chips.push(['★ starred','mstarred']);
  const lbl = g('mlabel').value; if (lbl) chips.push(['label:'+lbl,'mlabel']);
  const minwv=g('mminw').value, maxwv=g('mmaxw').value;
  if (minwv) chips.push(['words≥'+minwv,'mminw']); if (maxwv) chips.push(['words≤'+maxwv,'mmaxw']);
  const rdtv=g('mread').value; if (rdtv) chips.push(['read:'+rdtv,'mread']);
  const expv=g('mexp').value; if (expv) chips.push(['exp:'+expv,'mexp']);
  const bar = g('mem-chips');
  if (chips.length) {
    bar.style.display='flex';
    bar.innerHTML = chips.map(([label, selId])=>
      \`<span style="background:#1f4b8e33;border:1px solid #1f4b8e55;border-radius:12px;padding:2px 10px;color:#58a6ff;cursor:pointer" onclick="clearMemFilter('\${selId}')">\${esc(label)} ✕</span>\`
    ).join('') + \`<span style="color:#8b949e;cursor:pointer;padding:2px 6px" onclick="clearAllMemFilters()">Clear all</span>\`;
  } else {
    bar.style.display='none'; bar.innerHTML='';
  }
  const d = await api(_memUrl(0));
  g('ml').innerHTML = d.length ? d.map(card).join('') : '<p class="empty">No memories.</p>';
  _updateMoreBtn(d.length);
}

async function loadMoreMem() {
  _memOffset += _MEM_PAGE;
  const btn = g('mem-more-btn');
  btn.disabled = true; btn.textContent = 'Loading…';
  const d = await api(_memUrl(_memOffset));
  if (d.length) g('ml').insertAdjacentHTML('beforeend', d.map(card).join(''));
  btn.disabled = false; btn.textContent = 'Load more';
  _updateMoreBtn(d.length);
}

function _updateMoreBtn(pageCount) {
  const more = g('mem-more');
  if (pageCount >= _MEM_PAGE) {
    more.style.display = 'block';
    g('mem-count').textContent = \`showing \${_memOffset + pageCount}\`;
  } else {
    more.style.display = 'none';
    g('mem-count').textContent = '';
  }
}

function clearMemFilter(selId) {
  const el = g(selId);
  if (!el) return;
  if (el.type === 'checkbox') el.checked = false;
  else el.value = '';
  loadMem();
}
function clearAllMemFilters() {
  ['mtype','mtrust','mproj','mtag','mdomain','mconf','mimportance','mlabel','mminw','mmaxw','mread','mexp'].forEach(id => { const e=g(id); if(e) e.value=''; });
  g('msort').value='updated';
  const mp=g('mpinned'); if(mp) mp.checked=false;
  const ms=g('mstarred'); if(ms) ms.checked=false;
  loadMem();
}
function exportFilteredCsv() {
  let url = '/api/export?format=csv';
  const tg=g('mtag').value, t=g('mtype').value, r=g('mtrust').value;
  const p=g('mproj').value, dom=g('mdomain').value, imp=g('mimportance').value;
  if (tg)  url += '&tag='     + encodeURIComponent(tg);
  if (t)   url += '&type='    + encodeURIComponent(t);
  if (r)   url += '&trust='   + encodeURIComponent(r);
  if (p)   url += '&project=' + encodeURIComponent(p);
  if (dom) url += '&domain='  + encodeURIComponent(dom);
  if (imp) url += '&min_importance=' + encodeURIComponent(imp);
  const lbl2=g('mlabel').value; if (lbl2) url += '&label=' + encodeURIComponent(lbl2);
  const a = document.createElement('a'); a.href = url;
  a.download = (tg||t||r||p||dom||imp||lbl2) ? 'hive-filtered.csv' : 'hive-export.csv';
  a.click();
}
async function archiveAllFiltered() {
  const btn = g('arch-all-btn');
  const all = await api(_memUrl(0).replace(/limit=\d+/, 'limit=100000').replace(/offset=\d+/, 'offset=0'));
  if (!all.length) { alert('No memories match the current filter.'); return; }
  if (!confirm(\`Archive \${all.length} memor\${all.length===1?'y':'ies'} matching the current filter? This cannot be undone easily.\`)) return;
  btn.disabled = true; btn.textContent = 'archiving…';
  await fetch('/api/memories/bulk',{method:'POST',headers:{'Content-Type':'application/json','X-Hive-Local':'1'},body:JSON.stringify({ids:all.map(m=>m.id),action:'archive'})});
  btn.disabled = false; btn.textContent = '⚠ archive all';
  loadMem(); refreshStats();
}
function exportSelectionCsv() {
  if (!_sel.size) return;
  const url = '/api/export?format=csv&ids=' + [..._sel].map(encodeURIComponent).join(',');
  const a = document.createElement('a'); a.href = url; a.download = 'hive-selection.csv'; a.click();
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

let mgStop = null;
async function loadMemGraph() {
  if (mgStop) { mgStop(); mgStop = null; }
  const data = await api('/api/memories/graph');
  const canvas = g('mg-canvas');
  const W = canvas.parentElement.clientWidth || 900;
  const H = Math.max(500, Math.round(W * 0.6));
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!data.nodes.length) {
    ctx.fillStyle = '#8b949e'; ctx.font = '14px monospace';
    ctx.fillText('No memory links yet — create links with hive link add', 20, 40);
    g('mg-stats').textContent = '';
    return;
  }
  g('mg-stats').textContent = \`\${data.nodes.length} memories · \${data.edges.length} links\`;
  // Spread nodes on a large circle so initial forces are manageable
  const initR = Math.min(W, H) * 0.38;
  const nodes = data.nodes.map((n,i) => ({
    ...n, x: W/2 + Math.cos(i/data.nodes.length*Math.PI*2)*initR,
           y: H/2 + Math.sin(i/data.nodes.length*Math.PI*2)*initR*0.8, vx:0, vy:0
  }));
  const byId = Object.fromEntries(nodes.map(n => [n.id, n]));

  function simStep() {
    // Repulsion: normalized direction + soft minimum distance (prevents blow-up when overlapping)
    for (let i=0;i<nodes.length;i++) for (let j=i+1;j<nodes.length;j++) {
      const a=nodes[i],b=nodes[j];
      const dx=b.x-a.x, dy=b.y-a.y;
      const d=Math.sqrt(dx*dx+dy*dy)||1;
      const minD=a.size+b.size+16;
      const eff=Math.max(minD,d);
      const f=1400/(eff*eff);
      const nx=dx/d, ny=dy/d;
      a.vx-=nx*f; a.vy-=ny*f; b.vx+=nx*f; b.vy+=ny*f;
    }
    // Spring along edges (normalized)
    for (const e of data.edges) {
      const a=byId[e.from],b=byId[e.to]; if(!a||!b) continue;
      const dx=b.x-a.x, dy=b.y-a.y;
      const d=Math.sqrt(dx*dx+dy*dy)||1;
      const f=(d-150)*0.025;
      const nx=dx/d, ny=dy/d;
      a.vx+=nx*f; a.vy+=ny*f; b.vx-=nx*f; b.vy-=ny*f;
    }
    // Center gravity + velocity clamp + damping + bounds
    for (const n of nodes) {
      n.vx += (W/2-n.x)*0.0006; n.vy += (H/2-n.y)*0.0006;
      const spd=Math.sqrt(n.vx*n.vx+n.vy*n.vy);
      if (spd>5){n.vx=n.vx/spd*5;n.vy=n.vy/spd*5;}
      n.vx*=0.86; n.vy*=0.86;
      n.x=Math.max(n.size+4,Math.min(W-n.size-4,n.x+n.vx));
      n.y=Math.max(n.size+4,Math.min(H-n.size-4,n.y+n.vy));
    }
  }

  // Pre-settle before first draw so nodes don't start in a pile
  for (let s=0;s<60;s++) simStep();

  let running = true;
  mgStop = () => { running = false; };
  const tick = () => {
    if (!running) return;
    simStep();
    ctx.clearRect(0,0,W,H);
    // Draw edges
    for (const e of data.edges) {
      const a=byId[e.from],b=byId[e.to]; if(!a||!b) continue;
      ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y);
      ctx.strokeStyle=e.color+'88'; ctx.lineWidth=1.5; ctx.stroke();
    }
    // Draw nodes
    for (const n of nodes) {
      ctx.beginPath(); ctx.arc(n.x,n.y,n.size,0,Math.PI*2);
      ctx.fillStyle = n.pinned ? '#d29922' : n.color;
      ctx.fill();
      if (n.size > 8) {
        ctx.fillStyle='#c9d1d9'; ctx.font=\`\${Math.min(11,n.size)}px monospace\`;
        ctx.textAlign='center'; ctx.textBaseline='middle';
        const lbl = n.label.length>18 ? n.label.slice(0,16)+'…' : n.label;
        ctx.fillText(lbl, n.x, n.y+n.size+9);
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  // Legend
  const types = [...new Set(data.nodes.map(n=>n.type))];
  ctx.font='11px monospace';
  types.forEach((t,i) => {
    const col = data.nodes.find(n=>n.type===t)?.color||'#8b949e';
    ctx.fillStyle=col; ctx.fillRect(10,10+i*18,12,12);
    ctx.fillStyle='#8b949e'; ctx.textAlign='left'; ctx.textBaseline='top';
    ctx.fillText(t,28,10+i*18);
  });
}
const REM_COL = { critical: '#f85149', high: '#ffa657', medium: '#d29922', low: '#8b949e' };
async function loadReminders() {
  const urgency = g('rem-urgency').value;
  let url = '/api/reminders?limit=50';
  if (urgency) url += '&urgency=' + urgency;
  const d = await api(url);
  const { counts } = d;
  g('rem-summary').textContent =
    \`\${d.total} due · \${counts.critical} critical · \${counts.high} high · \${counts.medium} medium\`;
  if (!d.reminders.length) {
    g('rem-list').innerHTML = '<p class="empty">Nothing overdue — all memories are fresh.</p>';
    return;
  }
  g('rem-list').innerHTML = d.reminders.map(m => {
    const col = REM_COL[m.urgency] || '#8b949e';
    const idle = m.idle_days === 1 ? '1 day' : m.idle_days + ' days';
    return \`<div class="card" style="border-left:3px solid \${col}">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
        <span style="font-size:11px;font-weight:600;color:\${col};text-transform:uppercase;min-width:60px">\${m.urgency}</span>
        <span style="font-weight:500;color:#e6edf3;flex:1">\${esc(m.title)}</span>
        <span style="font-size:11px;color:#8b949e">\${idle} idle</span>
        <button class="btn" style="font-size:11px;padding:3px 8px;color:#3fb950" onclick="markReviewed('\${m.id}',this)">✓ reviewed</button>
      </div>
      <div style="font-size:12px;color:#8b949e">
        <span class="b bt">\${m.memory_type}</span>
        <span style="margin-left:6px">conf: \${(m.confidence*100|0)}%</span>
        <span style="margin-left:6px">importance: \${m.importance}</span>
      </div>
    </div>\`;
  }).join('');
}
// ── Knowledge Gaps ────────────────────────────────────────────────────────
const GAP_SEV = { high: '#f85149', medium: '#ffa657' };
const GAP_ICON = { low_confidence: '⚠', sparse: '📂', critical: '🔴' };
async function loadGaps() {
  const conf = +(g('gap-conf').value || 0.5);
  const imp  = +(g('gap-imp').value  || 7);
  const d = await api(\`/api/gaps?conf=\${conf}&importance=\${imp}&limit=30\`);
  const s = d.summary;
  g('gap-summary').textContent =
    \`\${d.total} gaps · \${s.low_confidence_domains} low-conf domains · \${s.critical_memories} critical memories\`;
  if (!d.gaps.length) {
    g('gap-list').innerHTML = '<p class="empty">No significant gaps found — knowledge base looks solid.</p>';
    return;
  }
  const byType = { low_confidence: [], sparse: [], critical: [] };
  for (const gap of d.gaps) (byType[gap.type] || []).push(gap);
  const section = (title, list) => {
    if (!list.length) return '';
    return \`<h4 style="font-size:13px;color:#8b949e;margin:16px 0 8px">\${title}</h4>
    <div style="display:flex;flex-wrap:wrap;gap:8px">\${list.map(gap => {
      const col = GAP_SEV[gap.severity] || '#8b949e';
      const extra = gap.scope === 'memory'
        ? \`<span style="font-size:11px;color:#8b949e;margin-left:6px">\${esc(gap.memory_type||'')} · imp \${gap.avg_importance}</span>\`
        : \`<span style="font-size:11px;color:#8b949e;margin-left:6px">\${gap.count} mem\${gap.count!==1?'s':''}</span>\`;
      return \`<div class="card" style="border-left:3px solid \${col};min-width:200px;max-width:340px">
        <div style="font-weight:500;color:#e6edf3;margin-bottom:4px">\${esc(gap.label)}\${extra}</div>
        <div style="font-size:12px;color:#8b949e">conf: \${(gap.avg_confidence*100|0)}%\${gap.scope!=='memory'?' avg':''} · <span style="color:\${col}">\${gap.severity} severity</span></div>
      </div>\`;
    }).join('')}</div>\`;
  };
  g('gap-list').innerHTML =
    section('🔴 Critical — high importance, low confidence', byType.critical) +
    section('⚠ Low Confidence', byType.low_confidence) +
    section('📂 Sparse Coverage', byType.sparse);
}

// ── Memory Health ─────────────────────────────────────────────────────────
const HLT_COL = { good: '#3fb950', fair: '#ffa657', poor: '#f85149' };
async function loadHealth() {
  const grade = g('hlt-grade').value || '';
  const sort  = g('hlt-sort').value  || 'asc';
  const url   = \`/api/health?limit=50&sort=\${sort}\${grade ? '&grade='+grade : ''}\`;
  const d     = await api(url);
  const s     = d.summary;
  g('hlt-summary').innerHTML =
    \`avg score: <b>\${s.avg_score}</b> &nbsp;
     <span style="color:#3fb950">good:\${s.good}</span> &nbsp;
     <span style="color:#ffa657">fair:\${s.fair}</span> &nbsp;
     <span style="color:#f85149">poor:\${s.poor}</span>\`;
  if (!d.memories.length) {
    g('hlt-list').innerHTML = '<p class="empty">No memories match.</p>';
    return;
  }
  g('hlt-list').innerHTML = d.memories.map(m => {
    const col  = HLT_COL[m.health_grade] || '#8b949e';
    const bar  = Math.round(m.health_score / 5); // 0-20 blocks
    const pips = '█'.repeat(bar) + '░'.repeat(20 - bar);
    return \`<div class="card" style="border-left:3px solid \${col}">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:18px;font-weight:700;color:\${col};min-width:34px;text-align:right">\${m.health_score}</span>
        <span style="font-family:monospace;font-size:11px;color:\${col};letter-spacing:-1px">\${pips}</span>
        <span style="font-weight:500;color:#e6edf3;flex:1">\${esc(m.title)}</span>
        <span style="font-size:11px;color:\${col};font-weight:600">\${m.health_grade}</span>
      </div>
      <div style="font-size:12px;color:#8b949e;margin-top:4px">
        <span class="b bt">\${m.memory_type}</span>
        <span style="margin-left:8px">conf: \${(m.confidence*100|0)}%</span>
        <span style="margin-left:8px">imp: \${m.importance}/10</span>
        \${m.domain ? \`<span style="margin-left:8px">domain: \${esc(m.domain)}</span>\` : ''}
      </div>
    </div>\`;
  }).join('');
}

// ── Confidence Calibration ────────────────────────────────────────────────
let _calChanges = [];
async function loadCalibrate() {
  g('cal-list').innerHTML = '<p class="empty">Loading…</p>';
  g('cal-apply-btn').style.display = 'none';
  _calChanges = await api('/api/calibrate/preview?limit=500');
  if (!_calChanges.length) {
    g('cal-summary').textContent = '';
    g('cal-list').innerHTML = '<p class="empty">All confidence scores are already well-calibrated.</p>';
    return;
  }
  g('cal-summary').textContent = \`\${_calChanges.length} change(s) pending\`;
  g('cal-apply-btn').style.display = '';
  const dec = _calChanges.filter(c => c.delta < 0).length;
  const inc = _calChanges.length - dec;
  g('cal-list').innerHTML = \`
    <div style="font-size:12px;color:#8b949e;margin-bottom:10px">
      <span style="color:#ffa657">-\${dec} decreases</span> &nbsp; <span style="color:#3fb950">+\${inc} increases</span>
    </div>\` +
    _calChanges.map(c => {
      const col = c.delta < 0 ? '#ffa657' : '#3fb950';
      const sign = c.delta > 0 ? '+' : '';
      return \`<div class="card" style="border-left:3px solid \${col};display:flex;align-items:center;gap:12px">
        <span style="font-weight:700;color:\${col};min-width:44px;font-size:13px">\${sign}\${(c.delta*100).toFixed(1)}%</span>
        <span style="flex:1;font-size:13px;color:#e6edf3">\${esc(c.title)}</span>
        <span style="font-size:11px;color:#8b949e;min-width:120px;text-align:right">\${c.old_confidence.toFixed(2)} &#8594; \${c.new_confidence.toFixed(2)}</span>
        <span style="font-size:11px;color:#484f58;min-width:140px">\${esc(c.reason)}</span>
      </div>\`;
    }).join('');
}
async function applyCalibrate() {
  const btn = g('cal-apply-btn');
  btn.disabled = true; btn.textContent = 'Applying…';
  const r = await fetch('/api/calibrate/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(x => x.json());
  btn.style.display = 'none';
  g('cal-summary').textContent = \`Applied \${r.applied} update(s).\`;
  g('cal-list').innerHTML += \`<p style="color:#3fb950;font-size:13px;margin-top:10px">Done — \${r.applied} confidence score(s) updated.</p>\`;
}

// ── Batch Markdown Import ─────────────────────────────────────────────────
let _impProposals = [];
async function importPreview() {
  const dirPath = g('imp-path').value.trim();
  if (!dirPath) { g('imp-status').textContent = 'Enter a directory path.'; return; }
  g('imp-status').textContent = 'Scanning…';
  g('imp-list').innerHTML = '';
  g('imp-go-btn').style.display = 'none';
  const r = await fetch('/api/import/dir', {
    method: 'POST', headers: {'Content-Type':'application/json','X-Hive-Local':'1'},
    body: JSON.stringify({ path: dirPath, auto: false })
  });
  const d = await r.json();
  if (d.error) { g('imp-status').textContent = '⚠ ' + d.error; return; }
  _impProposals = d.proposals || [];
  const skipped = d.skipped || [];
  g('imp-status').textContent = \`\${_impProposals.length} to import, \${skipped.length} already imported / skipped.\`;
  if (!_impProposals.length) { g('imp-list').innerHTML = '<p class="empty">Nothing new to import.</p>'; return; }
  g('imp-go-btn').style.display = '';
  g('imp-list').innerHTML = _impProposals.map(p =>
    \`<div class="card" style="font-size:12px">
      <div style="font-weight:600;color:#e6edf3">\${esc(p.title)}</div>
      <div style="color:#8b949e;margin-top:3px">\${esc(p._file)}</div>
      <div style="color:#484f58;margin-top:3px">\${esc((p.content||'').slice(0,120))}\${(p.content||'').length>120?'…':''}</div>
      <div style="margin-top:4px"><span class="b bt">\${esc(p.memory_type)}</span><span class="b bi">i=\${p.importance}</span>\${(p.tags||[]).map(t=>\`<span class="b" style="color:#79c0ff">#\${esc(t)}</span>\`).join('')}</div>
    </div>\`
  ).join('');
}
async function importAll() {
  const dirPath = g('imp-path').value.trim();
  if (!dirPath) return;
  const btn = g('imp-go-btn');
  btn.disabled = true; btn.textContent = 'Importing…';
  const r = await fetch('/api/import/dir', {
    method: 'POST', headers: {'Content-Type':'application/json','X-Hive-Local':'1'},
    body: JSON.stringify({ path: dirPath, auto: true })
  });
  const d = await r.json();
  btn.style.display = 'none';
  if (d.error) { g('imp-status').textContent = '⚠ ' + d.error; return; }
  const n = (d.stored || []).length;
  g('imp-status').textContent = \`✓ Imported \${n} memory/memories. \${(d.skipped||[]).length} skipped.\`;
  g('imp-list').innerHTML = \`<p style="color:#3fb950;font-size:13px">Done — \${n} new memories added.</p>\`;
  refreshStats();
}

// ── Memory Compare ────────────────────────────────────────────────────────
let _cmpA = null, _cmpB = null;
function initCompare() { g('cmp-out').innerHTML = ''; }
async function cmpSearch(side) {
  const inp = g('cmp-'+side);
  const listEl = g('cmp-'+side+'-list');
  const q = inp.value.trim(); if (q.length < 2) { listEl.innerHTML=''; return; }
  const d = await api('/api/memories?q='+encodeURIComponent(q)+'&limit=8&mode=keyword');
  const mems = d.memories || d;
  if (!mems.length) { listEl.innerHTML=''; return; }
  listEl.innerHTML = \`<div style="position:absolute;z-index:20;background:#161b22;border:1px solid #30363d;border-radius:6px;width:100%;max-height:200px;overflow-y:auto">\${
    mems.map(m=>\`<div onclick="cmpPick('\${side}','\${m.id}',\${JSON.stringify(m.title).replace(/'/g,"\\\\'")})" style="padding:8px 12px;cursor:pointer;border-bottom:1px solid #21262d;font-size:13px;color:#e6edf3" onmouseenter="this.style.background='#21262d'" onmouseleave="this.style.background=''">\${esc(m.title)}</div>\`).join('')
  }</div>\`;
}
function cmpPick(side, id, title) {
  if (side==='a') _cmpA=id; else _cmpB=id;
  g('cmp-'+side).value = title;
  g('cmp-'+side+'-list').innerHTML = '';
}
async function runCompare() {
  if (!_cmpA || !_cmpB) { g('cmp-out').innerHTML='<p class="empty">Pick two memories above, then click Compare.</p>'; return; }
  if (_cmpA===_cmpB) { g('cmp-out').innerHTML='<p class="empty">Pick two different memories.</p>'; return; }
  const d = await api(\`/api/memories/compare?id1=\${_cmpA}&id2=\${_cmpB}\`);
  if (d.error) { g('cmp-out').innerHTML=\`<p style="color:#f85149">\${esc(d.error)}</p>\`; return; }
  const changedFields = d.fields.filter(f=>f.changed);
  const sameFields = d.fields.filter(f=>!f.changed);
  const diffHtml = d.content_diff.map(op=>{
    const col = op.type==='add'?'#3fb950':op.type==='del'?'#f85149':'#8b949e';
    const pre = op.type==='add'?'+ ':op.type==='del'?'- ':'  ';
    return \`<div style="color:\${col};font-family:monospace;font-size:12px;white-space:pre-wrap">\${esc(pre+op.text)}</div>\`;
  }).join('');
  g('cmp-out').innerHTML = \`
    <div style="display:flex;gap:16px;margin-bottom:16px">
      <div class="card" style="flex:1"><strong style="color:#e6edf3">\${esc(d.a.title)}</strong><br><span style="font-size:11px;color:#8b949e">A</span></div>
      <div class="card" style="flex:1"><strong style="color:#e6edf3">\${esc(d.b.title)}</strong><br><span style="font-size:11px;color:#8b949e">B</span></div>
    </div>
    <div style="font-size:12px;color:#8b949e;margin-bottom:12px">\${d.changed_count} field\${d.changed_count!==1?'s':''} changed · content \${d.content_identical?'<span style="color:#3fb950">identical</span>':'<span style="color:#ffa657">differs</span>'}</div>
    \${changedFields.length ? \`<h4 style="font-size:13px;color:#ffa657;margin:0 0 8px">Changed fields</h4>
    <table style="border-collapse:collapse;width:100%;margin-bottom:16px;font-size:13px">
    \${changedFields.map(f=>\`<tr>
      <td style="padding:4px 10px 4px 0;color:#8b949e;white-space:nowrap">\${f.field}</td>
      <td style="padding:4px 10px;color:#f85149;text-decoration:line-through">\${esc(String(f.a??'—'))}</td>
      <td style="padding:4px 0;color:#3fb950">\${esc(String(f.b??'—'))}</td>
    </tr>\`).join('')}</table>\` : ''}
    \${!d.content_identical ? \`<h4 style="font-size:13px;color:#8b949e;margin:0 0 8px">Content diff</h4>
    <div style="background:#0d1117;border:1px solid #21262d;border-radius:6px;padding:12px;max-height:360px;overflow-y:auto">\${diffHtml}</div>\` : ''}
    \${sameFields.length ? \`<details style="margin-top:12px"><summary style="font-size:12px;color:#8b949e;cursor:pointer">\${sameFields.length} unchanged fields</summary>
    <table style="border-collapse:collapse;font-size:12px;margin-top:8px">
    \${sameFields.map(f=>\`<tr><td style="padding:3px 12px 3px 0;color:#8b949e">\${f.field}</td><td style="color:#8b949e">\${esc(String(f.a??'—'))}</td></tr>\`).join('')}</table></details>\` : ''}
  \`;
}
async function markReviewed(id, btn) {
  btn.disabled = true;
  const r = await fetch('/api/reminders/reviewed', { method:'POST',
    headers:{'Content-Type':'application/json','X-Hive-Local':'1'}, body:JSON.stringify({id}) });
  if (r.ok) btn.closest('.card').remove();
  else { btn.disabled = false; alert('Could not mark as reviewed.'); }
}
async function loadClusters() {
  const minShared = g('cl-min').value;
  const d = await api(\`/api/clusters?min_shared=\${minShared}\`);
  g('cl-summary').textContent = \`\${d.clusters.length} clusters · \${d.unclustered.length} unclustered\`;
  if (!d.clusters.length) {
    g('cl-list').innerHTML = '<p class="empty">No clusters yet — add tags to memories to group them.</p>';
    return;
  }
  const TYPE_COL = {core:'#ff7b72',domain:'#d2a8ff',project:'#3fb950',episodic:'#ffa657',semantic:'#58a6ff',skill:'#79c0ff'};
  g('cl-list').innerHTML = d.clusters.map((c, i) => {
    const tagChips = c.top_tags.map(t => \`<span class="b" style="color:#79c0ff">#\${esc(t)}</span>\`).join(' ');
    const preview = c.members.slice(0, 3).map(m =>
      \`<div style="font-size:12px;padding:4px 0;border-top:1px solid #21262d;color:#8b949e">
        <span style="color:\${TYPE_COL[m.memory_type]||'#8b949e'};margin-right:6px">●</span>\${esc(m.title)}
      </div>\`
    ).join('');
    const more = c.size > 3 ? \`<div style="font-size:11px;color:#8b949e;padding-top:4px">+\${c.size-3} more</div>\` : '';
    return \`<div class="card" style="margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <div style="font-size:18px;font-weight:700;color:#58a6ff;min-width:28px">\${c.size}</div>
        <div>
          <div style="font-weight:600;color:#e6edf3">\${esc(c.label)}</div>
          <div style="margin-top:3px">\${tagChips}</div>
        </div>
      </div>
      \${preview}\${more}
    </div>\`;
  }).join('');
}
async function loadTimeline() {
  const days  = g('tl-days').value;
  const gran  = g('tl-gran').value;
  const type  = g('tl-type').value;
  let url = \`/api/timeline?days=\${days}&granularity=\${gran}\`;
  if (type) url += '&type='+encodeURIComponent(type);
  const d = await api(url);
  g('tl-summary').textContent = \`\${d.total} memories added in last \${days} days\`;

  const max = Math.max(1, ...d.periods.map(p => p.count));
  const barW = Math.max(8, Math.min(40, Math.floor(600 / d.periods.length)));
  const TYPE_COL = {core:'#ff7b72',domain:'#d2a8ff',project:'#3fb950',episodic:'#ffa657',semantic:'#58a6ff',skill:'#79c0ff'};

  let chartHtml = '<div style="display:flex;align-items:flex-end;gap:2px;height:120px;padding:0 4px;overflow-x:auto">';
  d.periods.forEach((p, i) => {
    const h = p.count === 0 ? 2 : Math.max(4, Math.round(p.count / max * 110));
    const col = type ? (TYPE_COL[type] || '#58a6ff') : '#58a6ff';
    const label = gran === 'week' ? p.date.slice(5) : p.date.slice(5);
    chartHtml += \`<div style="display:flex;flex-direction:column;align-items:center;cursor:pointer;flex-shrink:0;width:\${barW}px" onclick="tlShowDay(\${i})" title="\${p.date}: \${p.count}">
      <div style="width:\${barW-2}px;height:\${h}px;background:\${p.count?col:'#21262d'};border-radius:2px 2px 0 0"></div>
      \${barW >= 18 ? \`<div style="font-size:9px;color:#8b949e;transform:rotate(-45deg);transform-origin:top left;margin-top:4px;white-space:nowrap">\${label}</div>\` : ''}
    </div>\`;
  });
  chartHtml += '</div>';
  g('tl-chart').innerHTML = chartHtml;
  g('tl-detail').innerHTML = '';

  window._tlPeriods = d.periods;
}

function tlShowDay(i) {
  const p = window._tlPeriods[i];
  if (!p || !p.memories.length) { g('tl-detail').innerHTML = '<p class="empty">No memories on this date.</p>'; return; }
  g('tl-detail').innerHTML = \`<h4 style="font-size:12px;color:#8b949e;margin:0 0 10px;text-transform:uppercase;letter-spacing:.05em">\${p.date} — \${p.count} \${p.count===1?'memory':'memories'}</h4>\`
    + p.memories.map(m => card(m)).join('');
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

function refreshStats() { api('/api/stats').then(d => { g('stats').textContent = \`\${d.memories} memories · \${d.entities} entities · \${d.projects} projects\`; const b=g('pinned-badge'); if(d.pinned>0){b.textContent=d.pinned;b.style.display='inline';}else{b.style.display='none';} }); }
let _editId = null;
let _tplCache = null;
async function _loadTemplates() {
  if (!_tplCache) _tplCache = await api('/api/templates').then(a => Object.fromEntries(a.map(t=>[t.memory_type,t])));
  return _tplCache;
}
const TPL_LABEL = {semantic:'📝 semantic',core:'⭐ core',domain:'🌐 domain',project:'🏗 project',episodic:'📅 episodic',skill:'🔧 skill'};
function renderTplChips(active) {
  if (!_tplCache) return;
  const row = g('nm-tpl-row'); if (row) row.style.display = 'block';
  g('nm-tpl-chips').innerHTML = Object.keys(_tplCache).map(t =>
    \`<button class="tpl-chip\${t===active?' on':''}" onclick="selectTemplate('\${t}')">\${TPL_LABEL[t]||t}</button>\`
  ).join('');
}
function selectTemplate(type) { g('nm-ty').value = type; applyTemplate(type); }
async function applyTemplate(type) {
  if (_editId) return;
  const tpls = await _loadTemplates();
  const tpl = tpls[type]; if (!tpl) return;
  if (tpl.title_hint && !g('nm-t').value) g('nm-t').placeholder = tpl.title_hint + '…';
  else if (!tpl.title_hint) g('nm-t').placeholder = 'Memory title';
  if (!g('nm-c').value && tpl.content_hint) g('nm-c').value = tpl.content_hint;
  g('nm-tr').value = tpl.trust_level;
  g('nm-i').value  = tpl.importance;
  g('nm-cf').value = tpl.confidence;
  if (tpl.tags.length && !g('nm-tg').value) g('nm-tg').value = tpl.tags.join(', ');
  renderTplChips(type);
}
function showAdd() { _editId=null; g('nm-h').textContent='Add Memory'; g('nm-t').value=''; g('nm-c').value=''; g('nm-ty').value='semantic'; g('nm-tr').value='OBSERVED'; g('nm-i').value='5'; g('nm-cf').value='0.5'; g('nm-tg').value=''; g('nm-nt').value=''; g('nm-ex').value=''; g('nm-err').textContent=''; g('add-modal').classList.add('on'); _loadTemplates().then(()=>renderTplChips('semantic')); }
async function showEdit(id) { const d=await api('/api/memories/'+id); _editId=id; g('nm-h').textContent='Edit Memory'; g('nm-t').value=d.title||''; g('nm-c').value=d.content||''; g('nm-ty').value=d.memory_type||'semantic'; g('nm-tr').value=d.trust_level||'OBSERVED'; g('nm-i').value=d.importance||5; g('nm-cf').value=d.confidence!=null?d.confidence:0.5; g('nm-tg').value=(d.tags||[]).join(', '); g('nm-nt').value=d.note||''; g('nm-ex').value=d.expires_at?new Date(d.expires_at).toISOString().slice(0,10):''; g('nm-err').textContent=''; g('add-modal').classList.add('on'); }
function closeAdd() { g('add-modal').classList.remove('on'); g('nm-dup').style.display='none'; }
function _buildPayload() {
  const rawTags = g('nm-tg').value.split(',').map(t=>t.trim()).filter(Boolean);
  const exDate = g('nm-ex').value; const expires_at = exDate ? new Date(exDate).getTime() : undefined;
  return { title: g('nm-t').value.trim(), content: g('nm-c').value.trim(), memory_type: g('nm-ty').value, trust_level: g('nm-tr').value, importance: +g('nm-i').value, confidence: +g('nm-cf').value, tags: rawTags, note: g('nm-nt').value.trim() || undefined, expires_at };
}
async function _doSave(payload) {
  const r = _editId
    ? await fetch('/api/memories/'+_editId, { method:'PUT',  headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) })
    : await fetch('/api/memories',           { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
  if (!r.ok) { const e = await r.json(); g('nm-err').textContent = e.error || 'Save failed.'; return false; }
  closeAdd(); loadMem(); refreshStats(); loadTagSelect(); _allTags = null; return true;
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
async function duplicateMem(id) {
  const r = await fetch(\`/api/memories/\${id}/duplicate\`, {method:'POST',headers:{'X-Hive-Local':'1'}});
  if (!r.ok) { alert('Duplicate failed'); return; }
  const d = await r.json();
  loadMem();
  showEdit(d.id);
}
async function applyTemplate(id, type) {
  if (!type) return;
  const tpls = await _loadTemplates();
  const tpl = tpls[type];
  if (!tpl) return;
  const m = await api('/api/memories/' + id);
  const tags = [...new Set([...(m.tags||[]), ...(tpl.tags||[])])];
  await fetch('/api/memories/' + id, {
    method: 'PUT',
    headers: {'Content-Type':'application/json','X-Hive-Local':'1'},
    body: JSON.stringify({ memory_type: tpl.memory_type, trust_level: tpl.trust_level, importance: tpl.importance, confidence: tpl.confidence, tags })
  });
  loadMem();
}
async function toggleRelated(id) {
  const el = g('rel-' + id);
  if (!el) return;
  if (el.style.display !== 'none') { el.style.display = 'none'; return; }
  el.style.display = 'block';
  if (el.dataset.loaded) return;
  el.innerHTML = '<p class="empty" style="font-size:12px;padding:8px 0">Loading…</p>';
  const data = await api('/api/memories/' + id + '/related');
  el.dataset.loaded = '1';
  if (!data.length) { el.innerHTML = '<p class="empty" style="font-size:12px">No related memories found.</p>'; return; }
  var html = '<div style="font-size:11px;color:#8b949e;margin-bottom:6px">Related memories</div>';
  for (var i = 0; i < data.length; i++) {
    var m = data[i];
    var preview = esc((m.content||'').slice(0,120)) + ((m.content||'').length>120?'…':'');
    html += '<div style="padding:6px 8px;margin-bottom:4px;background:#0d1117;border-radius:4px;border:1px solid #21262d;font-size:12px;cursor:pointer" onclick="showEdit(&quot;' + m.id + '&quot;)">'
      + '<span style="font-weight:600;color:#e6edf3">' + esc(m.title) + '</span>'
      + '<span style="color:#8b949e;display:block;margin-top:2px">' + preview + '</span>'
      + '</div>';
  }
  el.innerHTML = html;
}
async function togglePin(id, pin) {
  await fetch(\`/api/memories/\${id}/\${pin?'pin':'unpin'}\`, {method:'POST',headers:{'X-Hive-Local':'1'}});
  loadMem();
}
async function toggleStar(id, star) {
  await fetch(\`/api/memories/\${id}/\${star?'star':'unstar'}\`, {method:'POST',headers:{'X-Hive-Local':'1'}});
  loadMem();
}
function copyLink(id) {
  const url = location.origin + '/#' + id;
  navigator.clipboard.writeText(url).then(() => {
    const btn = g('cl-' + id);
    if (!btn) return;
    const orig = btn.textContent;
    btn.textContent = '✓ copied';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  }).catch(() => {});
}
async function shareCard(id) {
  const m = await api(\`/api/memories/\${id}\`);
  const sep = '─'.repeat(48);
  const tags = (m.tags||[]).map(t=>'#'+t).join(' ');
  const lines = [
    sep,
    m.title,
    \`Type: \${m.memory_type}  |  Trust: \${m.trust_level}  |  Importance: \${m.importance}\`,
    tags ? \`Tags: \${tags}\` : null,
    sep,
    m.content || '',
    m.note ? '' : null,
    m.note ? \`Note: \${m.note}\` : null,
    '',
    \`(from HIVE · \${new Date(m.created_at).toLocaleDateString()})\`,
    sep,
  ].filter(l => l !== null).join('\\n');
  g('share-ta').value = lines;
  g('share-copy-btn').textContent = '📋 Copy';
  g('share-modal').classList.add('on');
}
function shareCardCopy() {
  navigator.clipboard.writeText(g('share-ta').value).then(() => {
    const btn = g('share-copy-btn');
    btn.textContent = '✓ Copied!';
    setTimeout(() => { btn.textContent = '📋 Copy'; }, 1500);
  }).catch(() => {});
}
async function setLabel(id, label) {
  await localFetch(\`/api/memories/\${id}\`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({label:label||null})});
  loadMem();
}
function editNote(id, containerEl) {
  const existing = containerEl.dataset.note || (containerEl.tagName === 'DIV' && containerEl.style.borderLeft ? containerEl.textContent.trim() : '');
  const ta = document.createElement('textarea');
  ta.value = existing;
  ta.rows = 2;
  ta.style.cssText = 'width:100%;font-size:12px;background:#1c2128;color:#c9a227;border:1px solid #d29922;border-radius:4px;padding:4px 6px;resize:vertical;box-sizing:border-box';
  ta.placeholder = 'Short note or reminder…';
  containerEl.replaceWith(ta);
  ta.focus();
  let saved = false;
  async function save() {
    if (saved) return; saved = true;
    const note = ta.value.trim();
    await localFetch(\`/api/memories/\${id}\`, {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({note: note || null})});
    loadMem();
  }
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); } else if (e.key === 'Escape') { saved = true; loadMem(); } });
  ta.addEventListener('blur', save);
}
async function removeTag(id, tag) {
  const m = await api('/api/memories/' + id);
  const tags = (m.tags||[]).filter(t => t !== tag);
  await localFetch('/api/memories/' + id, {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({tags})});
  loadMem();
}
function renameTagInline(id, oldTag, spanEl) {
  const inp = document.createElement('input');
  inp.value = oldTag;
  inp.style.cssText = 'width:80px;font-size:12px;background:#0d1117;color:#e6edf3;border:1px solid #58a6ff;border-radius:3px;padding:1px 4px';
  spanEl.replaceWith(inp);
  inp.focus(); inp.select();
  let saved = false;
  async function save() {
    if (saved) return; saved = true;
    const newTag = inp.value.trim();
    if (!newTag || newTag === oldTag) { loadMem(); return; }
    const m = await api('/api/memories/' + id);
    const tags = (m.tags||[]).map(t => t === oldTag ? newTag : t);
    await localFetch('/api/memories/' + id, {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({tags})});
    loadMem();
  }
  inp.addEventListener('keydown', e => { if (e.key==='Enter') save(); else if (e.key==='Escape') { saved=true; loadMem(); } });
  inp.addEventListener('blur', save);
}
async function inlineEdit(id) {
  const card = document.querySelector('.card[data-id="' + id + '"]');
  if (!card || card.dataset.editing) return;
  card.dataset.editing = '1';
  card.style.borderColor = '#3fb950';
  const m = await api('/api/memories/' + id);
  card.dataset.origTitle = m.title;
  card.dataset.origContent = m.content || '';
  const titleEl = card.querySelector('.ct-title');
  if (titleEl) titleEl.outerHTML = '<input class="ie-inp" id="ie-t-' + id + '" value="' + esc(m.title) + '" style="flex:1;min-width:0;background:#0d1117;border:1px solid #3fb950;color:#e6edf3;border-radius:4px;padding:2px 6px;font-size:14px;font-weight:600">';
  const cc = card.querySelector('.cc');
  if (cc) cc.innerHTML = '<textarea id="ie-c-' + id + '" style="width:100%;box-sizing:border-box;background:#0d1117;border:1px solid #3fb950;color:#e6edf3;border-radius:4px;padding:4px 6px;font-size:13px;resize:vertical;min-height:80px">' + esc(m.content || '') + '</textarea>';
  const ct = card.querySelector('.ct');
  if (ct) ct.insertAdjacentHTML('beforeend',
    '<button class="btn ie-btn" id="ie-save-' + id + '" style="font-size:11px;padding:2px 8px;color:#3fb950;margin-left:4px" onclick="inlineEditSave(&quot;' + id + '&quot;)">✓ save</button>'
    + '<button class="btn ie-btn" style="font-size:11px;padding:2px 8px;margin-left:2px" onclick="inlineEditCancel(&quot;' + id + '&quot;)">✕</button>');
}
async function inlineEditSave(id) {
  const tInput = document.getElementById('ie-t-' + id);
  const cInput = document.getElementById('ie-c-' + id);
  if (!tInput || !cInput) return;
  const title = tInput.value.trim();
  const content = cInput.value.trim();
  if (!title)   { tInput.style.borderColor = '#f85149'; return; }
  if (!content) { cInput.style.borderColor = '#f85149'; return; }
  const btn = document.getElementById('ie-save-' + id);
  if (btn) btn.textContent = '…';
  const r = await fetch('/api/memories/' + id, {
    method: 'PUT',
    headers: {'Content-Type':'application/json','X-Hive-Local':'1'},
    body: JSON.stringify({ title: title, content: content })
  });
  if (!r.ok) { if (btn) btn.textContent = '✓ save'; return; }
  _inlineRestore(id, title, content);
}
function inlineEditCancel(id) {
  const card = document.querySelector('.card[data-id="' + id + '"]');
  if (card) _inlineRestore(id, card.dataset.origTitle, card.dataset.origContent);
}
function _inlineRestore(id, title, content) {
  const card = document.querySelector('.card[data-id="' + id + '"]');
  if (!card) return;
  delete card.dataset.editing; card.style.borderColor = '';
  const tEl = document.getElementById('ie-t-' + id);
  if (tEl) tEl.outerHTML = '<span class="ct-title" ondblclick="inlineEdit(&quot;' + id + '&quot;)" title="Double-click to edit inline" style="cursor:text">' + esc(title) + '</span>';
  const cc = card.querySelector('.cc');
  if (cc) { var p = (content||'').slice(0,280); cc.innerHTML = esc(p) + ((content||'').length>280?'…':''); cc.ondblclick = function(){ inlineEdit(id); }; }
  card.querySelectorAll('.ie-btn').forEach(function(b){ b.remove(); });
  const relEl = g('rel-' + id);
  if (relEl) { relEl.style.display = 'none'; delete relEl.dataset.loaded; }
}
function filterTag(tag) {
  const sel = g('mtag');
  if (sel.value === tag) { sel.value = ''; loadMem(); return; } // toggle off if already active
  if (![...sel.options].some(o => o.value === tag)) { // ensure option exists
    const o = document.createElement('option'); o.value = tag; o.textContent = tag; sel.appendChild(o);
  }
  sel.value = tag;
  const memBtn = [...document.querySelectorAll('nav button')].find(b => b.textContent === 'Memories');
  if (memBtn && memBtn.classList.contains('on')) loadMem();
  else if (memBtn) memBtn.click();
}
function loadTagSelect() { api('/api/tags').then(ts => { const sel=g('mtag'); sel.innerHTML='<option value="">All tags</option>'; ts.forEach(({tag,count})=>{const o=document.createElement('option');o.value=tag;o.textContent=tag+' ('+count+')';sel.appendChild(o);}); }); }
let _allTags = null;
let _tagSugIdx = -1;
async function _loadAllTags() {
  if (!_allTags) _allTags = (await api('/api/tags')).map(t => t.tag);
  return _allTags;
}
async function tagSuggest(inp) {
  _tagSugIdx = -1;
  const parts = inp.value.split(',');
  const partial = parts[parts.length - 1].trim().toLowerCase();
  const sug = g('nm-tg-sug');
  if (!partial || partial.length < 1) { sug.style.display = 'none'; return; }
  const all = await _loadAllTags();
  const existing = new Set(parts.slice(0, -1).map(t => t.trim().toLowerCase()));
  const matches = all.filter(t => t.toLowerCase().startsWith(partial) && !existing.has(t.toLowerCase())).slice(0, 8);
  if (!matches.length) { sug.style.display = 'none'; return; }
  sug.innerHTML = matches.map((t, i) => \`<div data-tag="\${esc(t)}" data-sug-idx="\${i}" style="padding:6px 10px;cursor:pointer;font-size:13px;color:#e6edf3" onmousedown="pickTagSug('\${esc(t)}')" onmouseenter="_sugHover(\${i})" onmouseleave="_sugHover(-1)">🏷 \${esc(t)}</div>\`).join('');
  sug.style.display = 'block';
}
function _sugHover(i) {
  _tagSugIdx = i;
  const sug = g('nm-tg-sug');
  Array.from(sug.children).forEach((el, j) => { el.style.background = j === i ? '#1f2937' : ''; });
}
function tagSuggestKey(e) {
  const sug = g('nm-tg-sug');
  if (!sug || sug.style.display === 'none') return;
  const rows = Array.from(sug.children);
  if (!rows.length) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    _tagSugIdx = (_tagSugIdx + 1) % rows.length;
    _sugHover(_tagSugIdx);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    _tagSugIdx = (_tagSugIdx - 1 + rows.length) % rows.length;
    _sugHover(_tagSugIdx);
  } else if (e.key === 'Enter' && _tagSugIdx >= 0) {
    e.preventDefault();
    pickTagSug(rows[_tagSugIdx].dataset.tag);
  } else if (e.key === 'Escape') {
    sug.style.display = 'none'; _tagSugIdx = -1;
  }
}
function pickTagSug(tag) {
  const inp = g('nm-tg');
  const parts = inp.value.split(',');
  parts[parts.length - 1] = ' ' + tag;
  inp.value = parts.join(',') + ', ';
  g('nm-tg-sug').style.display = 'none';
  _tagSugIdx = -1;
  inp.focus();
}
refreshStats();
loadBookmarks();
api('/api/projects').then(ps => { const sel=g('mproj'); ps.forEach(p=>{const o=document.createElement('option');o.value=p.id;o.textContent=p.name;sel.appendChild(o);}); });
loadTagSelect();
function loadHistory() { api('/api/search/history?limit=30').then(hs => { const dl=g('q-history'); dl.innerHTML=''; hs.forEach(h=>{const o=document.createElement('option');o.value=h.query;dl.appendChild(o);}); }); }
loadHistory();
function highlightCard(id) {
  const el = document.querySelector(\`[data-id="\${id}"]\`);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.style.outline = '2px solid #d29922';
  el.style.borderRadius = '6px';
  el.style.transition = 'outline .3s';
  setTimeout(() => { el.style.outline = ''; el.style.borderRadius = ''; }, 2500);
}
async function checkHashHighlight() {
  const id = location.hash.slice(1);
  if (!id) return;
  const memNavBtn = document.querySelector('nav button[onclick*="memories"]');
  if (memNavBtn) { show('memories', memNavBtn); } else { await loadMem(); }
  await new Promise(r => setTimeout(r, 300));
  highlightCard(id);
}
if (location.hash) checkHashHighlight();
window.addEventListener('hashchange', () => checkHashHighlight());

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
let _lkMemId = null;
async function showLinks(memId) {
  _lkMemId = memId;
  g('lk-err').textContent = '';
  g('lk-to').value = ''; g('lk-notes').value = '';
  g('link-modal').style.display = 'flex';
  await _renderLinks();
}
async function _renderLinks() {
  const ls = await api('/api/memories/'+_lkMemId+'/links');
  if (!ls.length) { g('lk-list').innerHTML='<p class="empty">No links yet.</p>'; return; }
  const relCol = { related:'#79c0ff', supports:'#3fb950', contradicts:'#f85149', supersedes:'#d2a8ff', predecessor:'#ffa657', 'see-also':'#8b949e' };
  g('lk-list').innerHTML = ls.map(l => {
    const isFrom = l.from_id === _lkMemId;
    const other = isFrom ? l.to_title : l.from_title;
    const otherId = isFrom ? l.to_id : l.from_id;
    const col = relCol[l.rel_type] || '#8b949e';
    const dir = isFrom ? '→' : '←';
    return \`<div class="card" style="display:flex;align-items:center;gap:10px;padding:8px 12px">
      <span style="color:\${col};font-size:12px;white-space:nowrap">\${dir} \${l.rel_type}</span>
      <span style="flex:1;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="\${esc(otherId)}">\${esc(other||otherId)}</span>
      \${l.notes?'<span style="font-size:11px;color:#8b949e">'+esc(l.notes)+'</span>':''}
      <button class="arch" onclick="removeLink('\${l.id}')">× remove</button>
    </div>\`;
  }).join('');
}
async function addLink() {
  const toId = g('lk-to').value.trim();
  const relType = g('lk-type').value;
  const notes = g('lk-notes').value.trim() || null;
  if (!toId) { g('lk-err').textContent = 'Target memory ID is required'; return; }
  const r = await fetch('/api/memories/'+_lkMemId+'/links', {
    method:'POST', headers:{'Content-Type':'application/json','X-Hive-Local':'1'},
    body: JSON.stringify({ to_id: toId, rel_type: relType, notes })
  });
  const d = await r.json();
  if (d.error) { g('lk-err').textContent = d.error; return; }
  g('lk-err').textContent = ''; g('lk-to').value = ''; g('lk-notes').value = '';
  await _renderLinks();
}
async function removeLink(linkId) {
  await fetch('/api/links/'+linkId, {method:'DELETE',headers:{'X-Hive-Local':'1'}});
  await _renderLinks();
}
async function loadDecayPreview() {
  g('dc-body').innerHTML = '<p class="empty">Loading…</p>';
  const d = await api('/api/decay/preview');
  if (!d.changes.length) { g('dc-body').innerHTML = '<p class="empty">No memories eligible for decay.</p>'; return; }
  g('dc-body').innerHTML = d.changes.map(c => \`<div style="padding:6px 0;border-bottom:1px solid #21262d;font-size:13px;display:flex;gap:12px;align-items:center">
    <span style="flex:1;color:#c9d1d9;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="\${esc(c.id)}">\${esc(c.title)}</span>
    <span class="b bt">\${c.memory_type}</span>
    <span style="color:#8b949e;font-size:11px">\${c.idle_days}d idle</span>
    <span style="color:#ffa657">\${(c.confidence*100|0)}% → \${(c.new_confidence*100|0)}%</span>
  </div>\`).join('') + \`<p style="margin-top:12px;font-size:12px;color:#8b949e">\${d.changes.length} memories would decay. Click "Apply decay" to commit.</p>\`;
}
async function obsidianExport() {
  const files = await api('/api/export/obsidian');
  if (!files.length) { alert('No active memories to export.'); return; }
  // Bundle as a single text blob with file separators for quick copy, or download each
  const text = files.map(f => \`===== \${f.filename} =====\\n\${f.content}\`).join('\\n\\n');
  const blob = new Blob([text], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'hive-obsidian.txt';
  a.click();
}
async function runDecay() {
  if (!confirm('Apply confidence decay to all eligible memories?')) return;
  const r = await fetch('/api/decay/run', {method:'POST',headers:{'Content-Type':'application/json','X-Hive-Local':'1'},body:'{}'});
  const d = await r.json();
  g('dc-body').innerHTML = \`<p style="color:#3fb950">Applied decay to \${d.applied} memories.</p>\`;
  refreshStats();
}
async function loadConflicts() {
  const d = await api('/api/conflicts');
  const total = d.conflicted.length + d.contradictLinks.length + d.superseded.length;
  if (!total) { g('cf-body').innerHTML = '<p class="empty">No conflicts detected.</p>'; return; }
  let html = '';
  const resolve = async (id, action, btn) => {
    btn.disabled = true;
    await fetch(\`/api/memories/\${id}/resolve\`, {method:'POST',headers:{'Content-Type':'application/json','X-Hive-Local':'1'},body:JSON.stringify({action})});
    loadConflicts();
  };
  if (d.conflicted.length) {
    html += \`<h4 style="font-size:12px;color:#8b949e;text-transform:uppercase;letter-spacing:.05em;margin:0 0 8px">Marked CONFLICTED (\${d.conflicted.length})</h4>\`;
    html += d.conflicted.map(m => \`<div style="padding:8px 0;border-bottom:1px solid #21262d;display:flex;gap:8px;align-items:center;font-size:13px">
      <span style="flex:1;color:#c9d1d9">\${esc(m.title)}</span>
      <span class="b bt">\${m.memory_type}</span>
      <button class="btn" style="font-size:11px;color:#3fb950" onclick="(async(b)=>{b.disabled=true;await fetch('/api/memories/\${m.id}/resolve',{method:'POST',headers:{'Content-Type':'application/json','X-Hive-Local':'1'},body:JSON.stringify({action:'trust'})});loadConflicts()})(this)">✓ trust</button>
      <button class="btn" style="font-size:11px;color:#ffa657" onclick="(async(b)=>{b.disabled=true;await fetch('/api/memories/\${m.id}/resolve',{method:'POST',headers:{'Content-Type':'application/json','X-Hive-Local':'1'},body:JSON.stringify({action:'downgrade'})});loadConflicts()})(this)">↓ outdated</button>
      <button class="arch" onclick="(async(b)=>{b.disabled=true;await fetch('/api/memories/\${m.id}/resolve',{method:'POST',headers:{'Content-Type':'application/json','X-Hive-Local':'1'},body:JSON.stringify({action:'archive'})});loadConflicts()})(this)">archive</button>
    </div>\`).join('');
  }
  if (d.contradictLinks.length) {
    html += \`<h4 style="font-size:12px;color:#8b949e;text-transform:uppercase;letter-spacing:.05em;margin:16px 0 8px">Contradicting pairs (\${d.contradictLinks.length})</h4>\`;
    html += d.contradictLinks.map(l => \`<div style="padding:8px 0;border-bottom:1px solid #21262d;font-size:13px">
      <span style="color:#f85149">\${esc(l.from_title)}</span>
      <span style="color:#8b949e;margin:0 8px">contradicts</span>
      <span style="color:#f85149">\${esc(l.to_title)}</span>
      <span style="color:#8b949e;font-size:11px;margin-left:8px">\${l.notes || ''}</span>
    </div>\`).join('');
  }
  if (d.superseded.length) {
    html += \`<h4 style="font-size:12px;color:#8b949e;text-transform:uppercase;letter-spacing:.05em;margin:16px 0 8px">Superseded but still active (\${d.superseded.length})</h4>\`;
    html += d.superseded.map(m => \`<div style="padding:8px 0;border-bottom:1px solid #21262d;display:flex;gap:8px;align-items:center;font-size:13px">
      <span style="flex:1;color:#c9d1d9">\${esc(m.title)}</span>
      <span style="color:#8b949e;font-size:11px">superseded by: \${esc(m.superseded_by_title||'')}</span>
      <button class="arch" onclick="(async(b)=>{b.disabled=true;await fetch('/api/memories/\${m.id}/resolve',{method:'POST',headers:{'Content-Type':'application/json','X-Hive-Local':'1'},body:JSON.stringify({action:'archive'})});loadConflicts()})(this)">archive</button>
    </div>\`).join('');
  }
  g('cf-body').innerHTML = html;
}
async function loadDigest(period) {
  period = period || 'daily';
  ['dg-daily','dg-weekly'].forEach(id => g(id).style.fontWeight = id.endsWith(period) ? '700' : '400');
  const d = await api('/api/digest?period='+period);
  const ts = t => new Date(t).toLocaleDateString();
  const memList = (arr, fields) => arr.length
    ? arr.map(m => \`<div style="padding:6px 0;border-bottom:1px solid #21262d;font-size:13px">
        <span style="color:#c9d1d9">\${esc(m.title)}</span>
        <span class="b bt" style="margin-left:6px">\${m.memory_type}</span>
        \${fields.includes('conf') ? \`<span class="b" style="color:\${m.confidence<0.4?'#f85149':'#8b949e'}">\${(m.confidence*100|0)}%</span>\` : ''}
        \${fields.includes('date') ? \`<span style="color:#8b949e;font-size:11px;margin-left:6px">\${ts(m.created_at||m.updated_at)}</span>\` : ''}
      </div>\`).join('')
    : '<p class="empty">None.</p>';
  const section = (title, content) => \`
    <div style="margin-bottom:20px">
      <h4 style="margin:0 0 8px;font-size:12px;color:#8b949e;text-transform:uppercase;letter-spacing:.05em">\${title}</h4>
      \${content}
    </div>\`;
  let html = \`<div style="color:#8b949e;font-size:12px;margin-bottom:16px">Generated \${new Date(d.generated_at).toLocaleString()} · \${d.total_active} active memories</div>\`;
  html += section(\`New (last \${period==='weekly'?'7 days':'24 h'})\`, memList(d.new_memories, ['date']));
  html += section(\`Stale (not updated in \${period==='weekly'?'30':'7'} days)\`, memList(d.stale_memories, ['date']));
  if (d.low_conf_memories) html += section('Low confidence (< 40%)', memList(d.low_conf_memories, ['conf']));
  if (d.top_domains && d.top_domains.length) {
    const rows = d.top_domains.map(r => \`<div style="font-size:13px;padding:4px 0"><span style="color:#c9d1d9">\${esc(r.domain)}</span><span style="color:#8b949e;margin-left:8px">\${r.count} new</span></div>\`).join('');
    html += section('Top domains (new this week)', rows);
  }
  g('dg-body').innerHTML = html;
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
let _tcSelectedTag = null;
async function loadTagCloud() {
  const d = await api('/api/tags/stats?limit=80');
  const cloud = g('tc-cloud');
  const top = g('tc-top');
  if (!d.top.length) { cloud.innerHTML='<p class="empty">No tags yet — add tags when creating memories.</p>'; top.innerHTML=''; return; }
  const max = d.top[0].count;
  const minPx = 12, maxPx = 32;
  const colors = ['#79c0ff','#3fb950','#d2a8ff','#ffa657','#f85149','#58a6ff'];
  cloud.innerHTML = d.top.map((t, i) => {
    const size = minPx + Math.round((t.count / max) * (maxPx - minPx));
    const col = colors[i % colors.length];
    const active = _tcSelectedTag === t.tag;
    const style = \`font-size:\${size}px;color:\${col};margin:0 8px;cursor:pointer;display:inline-block;transition:opacity .15s\${active ? ';text-decoration:underline;opacity:1' : ';opacity:.75'}\`;
    return \`<span id="tc-tag-\${esc(t.tag.replace(/[^a-z0-9]/gi,'_'))}" style="\${style}" onclick="selectTag('\${esc(t.tag)}')" title="\${t.count} memor\${t.count===1?'y':'ies'}">#\${esc(t.tag)} <sup style="font-size:10px;opacity:.7">\${t.count}</sup></span>\`;
  }).join('');
  top.innerHTML = \`<table style="font-size:12px;border-collapse:collapse;width:100%;max-width:400px">\${d.top.slice(0,15).map((t,i)=>\`<tr><td style="padding:3px 8px;color:#8b949e">\${i+1}</td><td style="padding:3px 8px"><span style="cursor:pointer;color:#79c0ff" onclick="selectTag('\${esc(t.tag)}')">#\${esc(t.tag)}</span></td><td style="padding:3px 8px;color:#8b949e">\${t.count}</td></tr>\`).join('')}</table>\`;
}
function renderHeatmap(buckets) {
  if (!buckets.length) return '';
  const byWeek = {};
  buckets.forEach(b => { byWeek[b.week] = b.count; });
  const max = Math.max(...Object.values(byWeek));
  // Build last 52 weeks
  const cells = [];
  const now = new Date();
  for (let w = 51; w >= 0; w--) {
    const d = new Date(now);
    d.setDate(d.getDate() - w * 7);
    const year = d.getFullYear();
    const jan1 = new Date(year, 0, 1);
    const weekNum = Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7);
    const key = \`\${year}-\${String(weekNum).padStart(2,'0')}\`;
    const count = byWeek[key] || 0;
    const alpha = count === 0 ? 0.08 : 0.2 + 0.8 * (count / max);
    const col = \`rgba(63,185,80,\${alpha.toFixed(2)})\`;
    cells.push(\`<span title="\${key}: \${count} memor\${count===1?'y':'ies'}" style="display:inline-block;width:11px;height:11px;border-radius:2px;margin:1px;background:\${col}"></span>\`);
  }
  return \`<div style="margin-bottom:4px;font-size:11px;color:#8b949e">Activity (last 52 weeks)</div><div style="display:flex;flex-wrap:wrap;gap:1px">\${cells.join('')}</div>\`;
}
async function selectTag(tag) {
  _tcSelectedTag = tag;
  g('tc-active-label').textContent = '#' + tag;
  g('tc-active-tag').style.display = 'inline';
  loadTagCloud(); // re-render cloud with highlight
  const mems = await api(\`/api/memories?tag=\${encodeURIComponent(tag)}&limit=50\`);
  const res = g('tc-results');
  const list = g('tc-results-list');
  const heatEl = g('tc-heatmap');
  g('tc-results-title').textContent = \`\${mems.length} memor\${mems.length===1?'y':'ies'} tagged #\${tag}\`;
  g('tc-results-browse').dataset.tag = tag;
  res.style.display = 'block';
  // Fetch heatmap data
  api(\`/api/tags/heatmap?tag=\${encodeURIComponent(tag)}\`).then(buckets => {
    heatEl.innerHTML = renderHeatmap(buckets);
  }).catch(() => {});
  if (!mems.length) { list.innerHTML='<p class="empty">No memories with this tag.</p>'; return; }
  list.innerHTML = mems.map(m => \`<div class="card" style="padding:10px 14px">
    <div style="font-weight:500;color:#e6edf3;margin-bottom:3px">\${esc(m.title)}</div>
    <div style="font-size:12px;color:#8b949e">
      <span class="b bt">\${m.memory_type}</span>
      <span style="margin-left:8px">conf: \${(m.confidence*100|0)}%</span>
      <span style="margin-left:8px">imp: \${m.importance}</span>
      \${m.domain ? \`<span style="margin-left:8px">· \${esc(m.domain)}</span>\` : ''}
    </div>
  </div>\`).join('');
}
function clearTagFilter() {
  _tcSelectedTag = null;
  g('tc-active-tag').style.display = 'none';
  g('tc-results').style.display = 'none';
  g('tc-heatmap').innerHTML = '';
  loadTagCloud();
}
async function renameTagGlobal() {
  if (!_tcSelectedTag) return;
  const newName = prompt(\`Rename "#\${_tcSelectedTag}" to:\`);
  if (!newName || !newName.trim() || newName.trim() === _tcSelectedTag) return;
  const r = await localFetch('/api/tags/rename', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from: _tcSelectedTag, to: newName.trim() }) });
  const d = await r.json();
  if (d.error) { alert('Rename failed: ' + d.error); return; }
  _allTags = null;
  loadTagSelect();
  _tcSelectedTag = d.to;
  g('tc-active-label').textContent = '#' + d.to;
  loadTagCloud();
  selectTag(d.to);
  refreshStats();
}
async function mergeTagGlobal() {
  if (!_tcSelectedTag) return;
  const intoName = prompt(\`Merge "#\${_tcSelectedTag}" into tag:\`);
  if (!intoName || !intoName.trim() || intoName.trim() === _tcSelectedTag) return;
  const r = await localFetch('/api/tags/merge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from: _tcSelectedTag, into: intoName.trim() }) });
  const d = await r.json();
  if (d.error) { alert('Merge failed: ' + d.error); return; }
  _allTags = null;
  loadTagSelect();
  _tcSelectedTag = null;
  g('tc-active-tag').style.display = 'none';
  loadTagCloud();
  refreshStats();
}
function browseTag(e) {
  e.preventDefault();
  const tag = e.currentTarget.dataset.tag;
  filterByTag(tag);
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
var _lastDiffOps = [];
var _diffMode = 'side'; // 'side' | 'unified'
function _renderSideBySide(ops) {
  var rows = [];
  var i = 0;
  while (i < ops.length) {
    if (ops[i].type === 'eq') { rows.push({ l: ops[i].text, r: ops[i].text, t: 'eq' }); i++; }
    else {
      var dels = [], adds = [];
      while (i < ops.length && ops[i].type === 'del') { dels.push(ops[i].text); i++; }
      while (i < ops.length && ops[i].type === 'add') { adds.push(ops[i].text); i++; }
      var mx = Math.max(dels.length, adds.length);
      for (var k = 0; k < mx; k++) rows.push({ l: dels[k] != null ? dels[k] : null, r: adds[k] != null ? adds[k] : null, t: 'ch' });
    }
  }
  var th = 'padding:4px 8px;text-align:left;font-size:11px;color:#8b949e;border-bottom:1px solid #30363d;background:#161b22;position:sticky;top:0';
  var td = 'padding:2px 8px;vertical-align:top;white-space:pre-wrap;word-break:break-word;border-bottom:1px solid #161b22';
  var html = '<table style="width:100%;border-collapse:collapse;font-family:monospace"><thead><tr>'
    + '<th style="' + th + ';width:50%">Snapshot (old)</th><th style="' + th + ';width:50%">Current</th>'
    + '</tr></thead><tbody>';
  for (var ri = 0; ri < rows.length; ri++) {
    var row = rows[ri];
    if (row.t === 'eq') {
      html += '<tr><td style="' + td + ';color:#8b949e">' + esc(row.l) + '</td><td style="' + td + ';color:#8b949e">' + esc(row.r) + '</td></tr>';
    } else {
      var lStyle = row.l !== null ? td + ';background:#2d1f1f;color:#f85149' : td + ';background:#0d1117';
      var rStyle = row.r !== null ? td + ';background:#1a2d1a;color:#3fb950' : td + ';background:#0d1117';
      var lTxt = row.l !== null ? '- ' + esc(row.l) : '';
      var rTxt = row.r !== null ? '+ ' + esc(row.r) : '';
      html += '<tr><td style="' + lStyle + '">' + lTxt + '</td><td style="' + rStyle + '">' + rTxt + '</td></tr>';
    }
  }
  html += '</tbody></table>';
  return html;
}
function _renderUnified(ops) {
  return '<pre style="font-size:12px;line-height:1.6;white-space:pre-wrap;background:#0d1117;padding:12px;border-radius:6px;border:1px solid #21262d;overflow-x:auto">'
    + ops.map(function(op) {
      var t = esc(op.text);
      if (op.type === 'add') return '<span style="color:#3fb950;display:block">+ ' + t + '</span>';
      if (op.type === 'del') return '<span style="color:#f85149;display:block">- ' + t + '</span>';
      return '<span style="color:#8b949e;display:block">  ' + t + '</span>';
    }).join('') + '</pre>';
}
function toggleDiffMode() {
  _diffMode = _diffMode === 'side' ? 'unified' : 'side';
  g('hist-diff-toggle').textContent = _diffMode === 'side' ? 'Switch to unified' : 'Switch to side-by-side';
  g('hist-diff-out').innerHTML = _diffMode === 'side' ? _renderSideBySide(_lastDiffOps) : _renderUnified(_lastDiffOps);
}
async function showDiff(versionId) {
  const d = await api('/api/versions/'+versionId+'/diff');
  _lastDiffOps = d.diff;
  _diffMode = 'side';
  g('hist-diff-toggle').textContent = 'Switch to unified';
  g('hist-diff-out').innerHTML = _renderSideBySide(d.diff);
  g('hist-diff').style.display='block';
}

// ── Quick Capture ──────────────────────────────────────────────────────────
(function() {
  const qc = document.createElement('div');
  qc.id = 'qc-overlay';
  qc.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:1001;align-items:center;justify-content:center';
  qc.innerHTML = \`<div style="background:#161b22;border:1px solid #58a6ff;border-radius:12px;padding:24px;width:520px;max-width:90vw">
    <div style="color:#8b949e;font-size:12px;margin-bottom:8px">Quick capture — Enter to save · Shift+Enter for newline · Esc to cancel</div>
    <textarea id="qc-text" rows="4" style="width:100%;background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:6px;padding:10px;font-size:14px;resize:vertical;box-sizing:border-box" placeholder="Capture a thought…"></textarea>
    <div style="display:flex;gap:8px;margin-top:10px;align-items:center">
      <select id="qc-type" style="background:#21262d;color:#e6edf3;border:1px solid #30363d;border-radius:6px;padding:4px 8px;font-size:12px">
        <option value="semantic">semantic</option><option value="core">core</option><option value="episodic">episodic</option><option value="skill">skill</option>
      </select>
      <button onclick="quickCaptureSave()" style="background:#1f6feb;color:#fff;border:none;border-radius:6px;padding:6px 16px;cursor:pointer;font-size:13px">Save</button>
      <button onclick="quickCaptureClose()" style="background:#21262d;color:#e6edf3;border:1px solid #30363d;border-radius:6px;padding:6px 16px;cursor:pointer;font-size:13px">Cancel</button>
      <span id="qc-status" style="font-size:12px;color:#3fb950;display:none;margin-left:4px"></span>
    </div>
  </div>\`;
  document.body.appendChild(qc);
  qc.addEventListener('click', e => { if (e.target === qc) quickCaptureClose(); });
  g('qc-text').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); quickCaptureSave(); }
    if (e.key === 'Escape') quickCaptureClose();
  });
})();
function quickCaptureOpen() {
  const o = g('qc-overlay'); if (!o) return;
  o.style.display = 'flex';
  const t = g('qc-text'); if (t) { t.value = ''; t.focus(); }
  const s = g('qc-status'); if (s) s.style.display='none';
}
function quickCaptureClose() {
  const o = g('qc-overlay'); if (o) o.style.display = 'none';
}
async function quickCaptureSave() {
  const text = (g('qc-text')?.value || '').trim();
  if (!text) return;
  const type = g('qc-type')?.value || 'semantic';
  const r = await fetch('/api/capture', { method:'POST', headers:{'Content-Type':'application/json','X-Hive-Local':'1'}, body: JSON.stringify({ content: text, type }) });
  const s = g('qc-status');
  if (r.ok) {
    const m = await r.json();
    if (s) { s.textContent = \`✓ [\${m.id}] \${m.title}\`; s.style.color='#3fb950'; s.style.display='inline'; }
    setTimeout(quickCaptureClose, 1200);
    refreshStats();
  } else {
    if (s) { s.textContent = 'Error saving.'; s.style.color='#f85149'; s.style.display='inline'; }
  }
}

// ── Keyboard Shortcuts ─────────────────────────────────────────────────────
(function() {
  const overlay = document.createElement('div');
  overlay.id = 'kb-help';
  overlay.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:1000;align-items:center;justify-content:center';
  overlay.innerHTML = \`<div style="background:#161b22;border:1px solid #30363d;border-radius:12px;padding:28px 36px;min-width:320px;max-width:480px">
    <h3 style="margin:0 0 20px;color:#e6edf3;font-size:16px">Keyboard Shortcuts</h3>
    <table id="kb-table" style="border-collapse:collapse;width:100%"></table>
    <button onclick="document.getElementById('kb-help').style.display='none'" style="margin-top:20px;background:#21262d;color:#e6edf3;border:1px solid #30363d;border-radius:6px;padding:6px 16px;cursor:pointer">Close</button>
  </div>\`;
  document.body.appendChild(overlay);

  async function populateShortcuts() {
    const tbl = document.getElementById('kb-table');
    if (!tbl || tbl.rows.length) return; // already populated
    try {
      const d = await fetch('/api/shortcuts').then(r => r.json());
      tbl.innerHTML = (d.shortcuts || []).map(s =>
        \`<tr><td style="padding:6px 16px 6px 0;color:#58a6ff;font-family:monospace;font-size:14px">\${esc(s.key)}</td><td style="padding:6px 0;color:#e6edf3">\${esc(s.description)}</td></tr>\`
      ).join('');
    } catch {}
  }

  window.toggleHelp = function() {
    const v = overlay.style.display === 'flex';
    overlay.style.display = v ? 'none' : 'flex';
    if (!v) populateShortcuts();
  };
  document.body.appendChild(overlay);

  document.addEventListener('keydown', e => {
    const inInput = ['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName) || e.target.isContentEditable;
    if (e.key === '/' && !inInput) {
      e.preventDefault();
      const q = g('q'); if (q) { q.focus(); q.select(); }
    } else if (e.key === 'n' && !inInput && !e.ctrlKey && !e.metaKey) {
      showAdd();
    } else if (e.key === 'm' && !inInput) {
      document.querySelectorAll('nav button').forEach(b => { if (b.textContent==='Memories') b.click(); });
    } else if (e.key === 'r' && !inInput) {
      document.querySelectorAll('nav button').forEach(b => { if (b.textContent==='Reminders') b.click(); });
    } else if (e.key === 'q' && !inInput) {
      e.preventDefault(); quickCaptureOpen();
    } else if (e.key === 'Escape') {
      overlay.style.display = 'none';
      quickCaptureClose();
      const am = g('add-modal'); if (am) am.style.display='none';
      if (document.activeElement) document.activeElement.blur();
    } else if (e.key === '?' && !inInput) {
      toggleHelp();
    }
  });
  overlay.addEventListener('click', e => { if (e.target===overlay) overlay.style.display='none'; });
})();
</script>
</body></html>`;
