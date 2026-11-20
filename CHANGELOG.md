# CHANGELOG.md

## 2026-11-20 — Phase 56 Complete

**Phase 56: Memory Diff Viewer**

`src/server.js` (dashboard):
- History modal widened to 900px for side-by-side layout
- `<pre>` diff output replaced with `<div>` for table rendering
- Added `_renderSideBySide(ops)`: groups consecutive `del`/`add` ops into replacement rows, pairs them side-by-side (old left in red, new right in green, unchanged grey across both columns)
- Added `_renderUnified(ops)`: original unified `+/-` line rendering preserved as fallback
- Added `toggleDiffMode()`: switches between side-by-side and unified; updates button label; re-renders using cached `_lastDiffOps`
- `showDiff(versionId)`: now defaults to side-by-side; stores ops in `_lastDiffOps` for toggle re-render

`tests/test-phase56.js`: 10/10 passing

## 2026-11-20 — Phase 55 Complete

**Phase 55: Bulk Tag Editor**

`src/server.js` (backend):
- Added `add_tags` action to `handleBulk`: reads each memory's existing tags, merges new tags (Set dedup), writes back — no duplicates
- Added `remove_tags` action: filters out specified tags from each memory's tag list; silently skips absent tags

`src/server.js` (dashboard):
- Added tag input `#bulk-tags` and `+ tags` / `− tags` buttons to the bulk action bar
- Added `bulkTagOp(op)`: parses comma-separated tags from input, calls `add_tags` or `remove_tags` bulk action, clears selection and reloads; flashes input red if tags field is empty

`tests/test-phase55.js`: 10/10 passing

## 2026-11-20 — Phase 54 Complete

**Phase 54: Inline Memory Editing**

`src/server.js` (dashboard):
- Title text wrapped in `<span class="ct-title" ondblclick="inlineEdit(id)">` — double-click to enter edit mode
- `.cc` content div gains `ondblclick="inlineEdit(id)"` too
- `inlineEdit(id)`: fetches full memory, replaces title span with `<input>` and content with `<textarea>`, adds Save/Cancel buttons, highlights card border green
- `inlineEditSave(id)`: PUTs title+content, calls `_inlineRestore` on success; flashes red border on empty fields
- `inlineEditCancel(id)`: restores from `card.dataset.origTitle/origContent`
- `_inlineRestore(id, title, content)`: shared helper that restores display, cleans up buttons, resets related drawer cache

`tests/test-phase54.js`: 10/10 passing

## 2026-11-20 — Phase 53 Complete

**Phase 53: Related Memories Panel**

`src/server.js` (backend):
- Added `handleRelated(req, res, id, limit)`: fetches the target memory, builds a search query from its title + tags + retrieval_keywords, runs FTS5 search, excludes the source, returns top N (default 5, max 20)
- Added route `GET /api/memories/:id/related?limit=N`

`src/server.js` (dashboard):
- Added `~ related` button to every memory card in `card()`
- Added hidden `<div id="rel-{id}">` drawer inside each card
- Added `toggleRelated(id)`: toggle/lazy-load drawer; fetches the API once, renders mini-cards, caches result in `dataset.loaded`

`tests/test-phase53.js`: 10/10 passing

## 2026-11-20 — Phase 52 Complete

**Phase 52: Memory Templates UI**

`src/server.js`:
- Added `.tpl-chip` / `.tpl-chip.on` CSS for template picker chips
- Added `#nm-tpl-row` / `#nm-tpl-chips` HTML to the Add Memory modal
- Added `TPL_LABEL` map, `renderTplChips(active)`, `selectTemplate(type)` JS functions
- `applyTemplate(type)` now calls `renderTplChips` to sync the active chip
- `showAdd()` now calls `_loadTemplates().then(() => renderTplChips('semantic'))` to populate chips on open
- Also fixed: `updateStats()` → `refreshStats()` (Phase 45 quick-capture bug) and `Cache-Control: no-store` header on HTML responses; fixed `/\n/g` regex in template literal (`searchCard`)

`tests/test-phase52.js`: 10/10 passing

## 2026-11-20 — Phase 51 Complete

**Phase 51: Pagination**

`src/server.js` (backend):
- `handleMemories` now accepts `?offset=N` query param and passes it to `memory.list()`
- For server-side filters (type, domain, trust, etc.): offset passed directly to SQLite `LIMIT ? OFFSET ?`
- For client-side post-filters (tag, pinned): full set fetched, then `slice(offset, offset+limit)` applied
- Page size constant `MEM_PAGE = 50`

`src/server.js` (dashboard UI):
- Memories tab: "Load more" button + "showing N" count below the list
- `_memOffset` state tracks current offset; resets to 0 on any filter change
- `_memUrl(offset)` — builds the full query URL with all active filters + given offset
- `loadMoreMem()` — appends next page to `#ml` without replacing existing results
- `_updateMoreBtn(pageCount)` — shows/hides Load more based on whether a full page was returned

Tests: `tests/test-phase51.js` — 10/10 passing
Full regression: 420/420

## 2026-11-20 — Phase 50 Complete

**Phase 50: Full-text Search Highlighting**

`src/search.js`:
- Search query now selects `highlight(memories_fts, 1, '\x01', '\x02') AS highlight_title` and `snippet(memories_fts, 2, '\x01', '\x02', '…', 24) AS snippet` using SQLite FTS5 native functions
- `\x01` / `\x02` control chars used as highlight delimiters — survive JSON serialisation without escaping
- Falls back cleanly to existing LIKE search (no highlight fields) when FTS5 is unavailable

`src/server.js`:
- `hlEsc(s)` — HTML-escapes first, then promotes `\x01...\x02` markers to `<mark>` tags (XSS-safe: escaping runs before markup insertion)
- `searchCard(m)` — dedicated renderer for search results; uses `highlight_title` / `snippet` when present, otherwise falls back to plain `esc()` text
- `doSearch()` now renders with `searchCard()` instead of the generic `card()`
- Mark style: dark green background (`#2d4a1e`) with bright green text (`#7ee787`) matching the GitHub dark palette

Tests: `tests/test-phase50.js` — 10/10 passing
Full regression: 410/410

## 2026-11-20 — Phase 49 Complete

**Phase 49: Confidence Calibration**

`src/calibrate.js` (new):
- `TRUST_CEILING` map — max confidence each trust level can legitimately carry (USER_CONFIRMED=1.0, INFERRED=0.6, AI_HYPOTHESIS=0.4, OUTDATED=0.1, etc.)
- `HALF_LIFE` map — confidence decay half-life in days per trust level (USER_CONFIRMED=Infinity, OBSERVED=180d, AI_HYPOTHESIS=60d, etc.)
- `_calibrate(m)` — computes calibrated score: `min(conf, ceiling) × exp(−age_days / half_life)`, floored at 0.05
- `preview(opts)` — lists all memories where calibrated score differs from stored by ≥0.02, sorted most-decreased first
- `apply(opts)` — writes the calibrated scores back; returns `{ applied, changes }`

`src/server.js`:
- `GET /api/calibrate/preview` — preview pending changes
- `POST /api/calibrate/apply` — commit changes
- Dashboard: **Calibrate** tab — shows pending changes with delta bars and reason; "Apply changes" button

`src/hive.js`:
- `hive calibrate` — preview in terminal with color-coded deltas
- `hive calibrate --apply` — apply and report

Tests: `tests/test-phase49.js` — 10/10 passing
Full regression: 400/400

## 2026-11-20 — Phase 48 Complete

**Phase 48: Search Filters UI — domain, importance, sort**

`src/memory.js`:
- `list()` gains `min_importance` and `sort` params; `SORT_MAP` with 4 sort keys: `updated`, `created`, `importance`, `confidence`

`src/server.js`:
- `GET /api/domains` — returns distinct domain values from active memories
- `GET /api/memories` gains `?domain=`, `?min_importance=`, `?sort=` query params (passed through to `memory.list()`)
- `POST /api/memories` now also passes `domain` and `project_id` from request body (was silently dropped before)
- Dashboard **Memories** tab: added domain `<select>` (populated on first load), importance `<select>` (≥8 high / ≥6 medium+), sort `<select>` (updated/created/importance/confidence)
- Active filter chips bar: each active filter shown as a removable ✕ chip; "Clear all" button resets all filters

Tests: `tests/test-phase48.js` — 10/10 passing
Full regression: 390/390

## 2026-11-20 — Phase 47 Complete

**Phase 47: Tag Cloud UI — inline filtering**

`src/server.js`:
- Tags tab: clicking a tag now shows matching memories **inline** below the cloud (no navigation away)
- Selected tag highlighted with underline + count badge; active tag indicator + ✕ clear button in toolbar
- "Browse in Memories →" link for full browsing context
- Bug fix: `handleMemories` now fetches all records before applying `?tag=` / `?pinned=` post-filters, then slices to `?limit=`; previous behavior cut the fetch at 50 before filtering, silently dropping results

Tests: `tests/test-phase47.js` — 10/10 passing
Full regression: 380/380

## 2026-11-20 — Phase 46 Complete

**Phase 46: Memory Health Score**

`src/health.js` (new):
- `score(m)` — composite 0–100: confidence 40% + recency 30% + importance 30%; recency = `exp(−idle_days / 30)`
- `grade(score)` — `good` (≥70) / `fair` (40–69) / `poor` (<40)
- `list(opts)` — all active memories ranked by health; options: `limit`, `gradeFilter`, `domain`, `sortOrder` (asc=worst first / desc=best first)
- `summary` — `{ good, fair, poor, avg_score }`

`src/server.js`:
- `GET /api/health` — query params: `?limit`, `?grade`, `?domain`, `?sort`
- Dashboard: **Health** tab — progress-bar score display, grade filter, sort order toggle

`src/hive.js`:
- `hive health` — triage view (worst first by default)
- `--best`, `--grade`, `--domain`, `--limit` flags

Tests: `tests/test-phase46.js` — 10/10 passing
Full regression: 370/370

## 2026-11-20 — Phase 45 Complete

**Phase 45: Quick Capture**

`src/health.js` added above. For Phase 45 details see prior entry.

## 2026-11-20 — Phase 44 Complete

**Phase 44: Knowledge Gaps**

`src/gaps.js` (new):
- `get(opts)` — detects three gap types: `low_confidence` (domain/type avg confidence < threshold), `sparse` (domain with fewer than minCount memories), `critical` (high-importance + low-confidence individual memory)
- Options: `minCount=3`, `confThreshold=0.5`, `importanceFloor=7`, `limit=20`
- Returns: `{ gaps, total, summary }` with severity (`high`/`medium`) on each gap; sorted high → medium, then by ascending confidence
- Summary counts: `low_confidence_domains`, `low_confidence_types`, `sparse_domains`, `critical_memories`

`src/server.js`:
- `GET /api/gaps` — returns gap analysis result
- Dashboard: **Gaps** tab — interactive controls for threshold/minCount, severity-coloured cards

`src/hive.js`:
- `hive gaps` — prints gap analysis to terminal

Tests: `tests/test-phase44.js` — 10/10 passing
Full regression: 350/350 (phases 10–44), zero regressions

## 2026-11-20 — Phase 43 Complete

**Phase 43: Memory Compare**

`src/compare.js` (new):
- `diff(id1, id2)` — field-by-field comparison + LCS content diff; returns `{a, b, fields, content_diff, changed_count, content_identical}`
- `lineDiff(a, b)` — LCS-based line diff returning `[{type:'eq'|'add'|'del', text}]`
- `COMPARE_FIELDS` — the 8 fields compared (title, type, domain, confidence, importance, status, source, tags)

`src/server.js`:
- `GET /api/memories/compare?id1=X&id2=Y` — returns structured diff
- Dashboard: **Compare** tab — search and pick two memories, see changed fields (red strikethrough → green) + content diff block

`src/hive.js`:
- `hive compare <id1> <id2>` — terminal diff with color-coded add/del lines

Also fixed: Mem Graph physics (normalized forces + velocity clamping — nodes no longer bunch at edges)

Tests: `tests/test-phase43.js` — 10/10 passing
Full regression: 340/340 (phases 10–43), zero regressions

## 2026-11-20 — Phase 42 Complete

**Phase 42: Keyboard Shortcuts**

`src/shortcuts.js` (new):
- `SHORTCUTS` array — 6 shortcut definitions with `key`, `guard`, `action`, `description`
- Consumed by server.js at both runtime (help overlay) and API level

`src/server.js`:
- `GET /api/shortcuts` — returns `{ shortcuts: SHORTCUTS }` for introspection/testing
- Dashboard: keyboard event handler (`/` search, `n` new, `m` memories, `r` reminders, `Escape` close, `?` toggle help)
- Dashboard: `#kb-help` overlay — dark modal with shortcuts table; closes on backdrop click or Escape

`src/hive.js`:
- `hive shortcuts` — prints all shortcuts to terminal

Tests: `tests/test-phase42.js` — 10/10 passing
Full regression: 330/330 (phases 10–42), zero regressions

## 2026-11-20 — Phase 41 Complete

**Phase 41: Smart Reminders**

`src/reminders.js` (new):
- `get(opts)` — returns memories idle ≥7 days, sorted by urgency then importance
  - Urgency: `critical` (conf < 0.3 or idle > 60d), `high` (conf < 0.5 or idle > 30d),
    `medium` (conf < 0.7 or idle > 14d), `low` (everything else)
  - Options: `limit`, `urgencyFilter`, `projectId`
  - Returns: `{ reminders, total, counts }` with `idle_days` and `urgency` on each
- `markReviewed(id)` — stamps `last_accessed_at = now`, removing it from the queue
- `urgency(idleDays, confidence, importance)` — exported for testing

`src/server.js`:
- `GET /api/reminders` — query params: `?limit=N&urgency=X&project=Y`
- `POST /api/reminders/reviewed` — mark a memory reviewed (`{ id }`)
- Dashboard: **Reminders** tab with urgency color-coded cards; inline "✓ reviewed" button removes the card; urgency filter selector

`src/hive.js`:
- `hive reminders` — table of overdue memories with urgency icons
- Flags: `--urgency critical|high|medium|low`, `--limit N`

`tests/test-phase41.js` — 10/10 passing
Full regression: 320/320 (Phases 10–41, zero regressions)

## 2026-11-20 — Phase 40 Complete

**Phase 40: Memory Clusters**

`src/clusters.js` (new):
- `get(opts)` — groups active memories by shared tags using Union-Find
  - Options: `minShared` (default 2), `limit` (default 20)
  - Returns: `{ clusters: [{label, size, top_tags, members}], unclustered }`
  - Clusters sorted by size descending; label = top 2 shared tags
  - Memories with no shared tags (or below threshold) go to `unclustered`

`src/server.js`:
- `GET /api/clusters` — query params: `?min_shared=N&limit=N`
- Dashboard: **Clusters** tab with expandable cluster cards; each shows size, tag chips, top 3 member titles; min-shared selector filter

`src/hive.js`:
- `hive clusters` — text breakdown of clusters with member previews
- Flags: `--min-shared N`, `--limit N`

`tests/test-phase40.js` — 10/10 passing
Full regression: 310/310 (Phases 10–40, zero regressions)

## 2026-11-20 — Phase 39 Complete

**Phase 39: Knowledge Timeline**

`src/timeline.js` (new):
- `get(opts)` — returns memory creation grouped by date period
  - Options: `days` (default 30), `granularity` ('day'|'week'), `memory_type`, `domain`
  - Returns: `{ periods: [{date, ts, count, memories}], total, days, granularity }`
  - Fills zero-count periods so the chart has no gaps

`src/server.js`:
- `GET /api/timeline` — query params: `?days=N&granularity=day|week&type=T&domain=D`
- Dashboard: **Timeline** tab with CSS bar chart; click any bar to see memories from that period; filters for days/granularity/type

`src/hive.js`:
- `hive timeline` — ASCII bar chart of memory creation; flags: `--days N`, `--week`, `--type T`, `--domain D`

`tests/test-phase39.js` — 10/10 passing
Full regression: 300/300 (Phases 10–39, zero regressions)

## 2026-11-20 — Phase 38 Complete

**Phase 38: Memory Relations Graph**

`src/memgraph.js` (new):
- `build()` — returns `{ nodes, edges }` from active memories and their relationships
  - Nodes: `{ id, label, type, importance, confidence, pinned, color, size }` — size = `6 + importance * 1.4`
  - Edges: `{ id, from, to, rel_type, color }` — only between active memories
- `TYPE_COLORS` — hex palette for 6 memory types (core/domain/project/episodic/semantic/skill)
- `EDGE_COLORS` — hex palette for 6 rel types (related/supports/contradicts/supersedes/predecessor/see-also)

`src/server.js`:
- `GET /api/memories/graph` — returns full graph data
- Dashboard: **Mem Graph** tab with force-directed canvas simulation
  - Physics: repulsion + spring attraction + center gravity + damping
  - Nodes sized by importance, colored by memory type (pinned = gold)
  - Edges colored by rel_type; legend rendered on canvas
  - `mg-stats` shows node/edge counts

`src/hive.js`:
- `hive memory-graph` — text stats: total nodes/edges, breakdown by type and rel_type

`tests/test-phase38.js` — 10/10 passing
Full regression: 290/290 (Phases 10–38, zero regressions)

## 2026-11-20 — Phase 37 Complete

**Phase 37: Conflict Resolution**

`src/conflicts.js` (new):
- `detect()` — finds three categories of conflicts:
  - Memories with `trust_level = 'CONFLICTED'`
  - Memory pairs linked with `rel_type = 'contradicts'` (Phase 31)
  - Memories with `superseded_by` set but still active
- `markConflict(id1, id2, notes)` — adds a `contradicts` relationship and sets both memories to `CONFLICTED`
- `resolve(id, action)` — actions: `trust` (→ USER_CONFIRMED), `archive`, `downgrade` (→ OUTDATED)

`src/server.js`:
- `GET /api/conflicts` — returns full conflict report
- `POST /api/conflicts` — mark two memories as conflicting (`{ id1, id2, notes }`)
- `POST /api/memories/:id/resolve` — resolve one memory (`{ action }`)
- Dashboard: **Conflicts** tab with three sections + inline trust/archive/downgrade buttons

`src/hive.js`:
- `hive conflicts` — list all conflicts
- `hive conflicts mark <id1> <id2> [--notes "..."]`
- `hive conflicts resolve <id> --action trust|archive|downgrade`

`tests/test-phase37.js` — 10/10 passing
Full regression: 280/280 (Phases 10–37, zero regressions)

## 2026-11-20 — Phase 36 Complete

**Phase 36: Obsidian Export**

`src/obsidian.js` (new):
- `slugify(title)` — converts titles to safe kebab-case filenames
- `generate()` — returns `[{ filename, content, id, title }]` for all active memories
  - YAML frontmatter: id, title, memory_type, trust_level, confidence, importance, tags, domain, project_id, created, updated
  - `# Title` heading + full content body
  - `## Links` section with `[[wikilinks]]` for each memory-to-memory link (Phase 31)
  - `## Tags` section with `#hashtag` format
- `writeVault(dir)` — writes all files to a directory (creates it if needed), returns file count

`src/server.js`:
- `GET /api/export/obsidian` — returns full vault as JSON array for preview/download
- Dashboard header: "⬇ Obsidian" button — downloads vault as bundled `.txt`

`src/hive.js`:
- `hive obsidian [<dir>]` — writes vault to `./obsidian-vault/` (or specified dir)

`tests/test-phase36.js` — 10/10 passing
Full regression: 270/270 (Phases 10–36, zero regressions)

## 2026-11-20 — Phase 35 Complete

**Phase 35: Memory Decay**

`src/decay.js` (new):
- `preview({ minIdleDays=14 })` — lists memories whose confidence would decrease; sorted by idle days descending
- `run({ minIdleDays=14 })` — applies decay and returns `{ applied, changes }`
- `stalest({ projectId, limit })` — existing review helper preserved (was previously in this module)
- Decay rate: 1%/week idle for normal memories; 0.5%/week for pinned or high-importance (≥7); floor: 0.1

`src/server.js`:
- `GET /api/decay/preview?min_idle_days=N` — preview without applying
- `POST /api/decay/run` — applies decay; returns count + change list
- Dashboard: **Decay** tab with Preview and Apply buttons; idle days + confidence change per memory

`src/hive.js`:
- `hive decay` — preview (dry-run)
- `hive decay --run` — apply; `--min-idle-days=N` to adjust threshold

`tests/test-phase35.js` — 10/10 passing
Full regression: 260/260 (Phases 10–35, zero regressions)

## 2026-11-20 — Phase 34 Complete

**Phase 34: Scheduled Digests**

`src/digest.js` (new):
- `daily()` — new memories (last 24 h), stale memories (not updated in 7+ days), low-confidence memories (< 40%), total active count
- `weekly()` — new memories (last 7 days), stale memories (30+ days), top domains by new activity

`src/server.js`:
- `GET /api/digest` — returns daily digest (default) or `?period=weekly` for weekly
- Dashboard: **Digest** tab with Daily/Weekly toggle, sections for new, stale, and low-confidence memories

`src/hive.js`:
- `hive digest [--weekly]` — prints digest to stdout

`tests/test-phase34.js` — 10/10 passing
Full regression: 250/250 (Phases 10–34, zero regressions)

## 2026-11-20 — Phase 33 Complete

**Phase 33: Memory Pinning**

`src/db.js`:
- Schema v10: `ALTER TABLE memories ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0`

`src/memory.js`:
- `update()` ALLOWED fields now includes `'pinned'`
- `list()` ORDER BY: `pinned DESC, importance DESC, updated_at DESC`

`src/server.js`:
- `POST /api/memories/:id/pin` and `POST /api/memories/:id/unpin` endpoints
- `PUT /api/memories/:id` accepts `pinned` field
- `GET /api/memories?pinned=1` filter returns only pinned memories
- Dashboard: pinned cards get amber left border and "📌 pinned" toggle button
- "Pinned only" checkbox in memories filter bar

`src/hive.js`:
- `hive memory pin <id>` — pins a memory to top of list
- `hive memory unpin <id>` — unpins a memory

`tests/test-phase33.js` — 10/10 passing
Full regression: 240/240 (Phases 10–33, zero regressions)

## 2026-11-20 — Phase 32 Complete

**Phase 32: Search Bookmarks**

`src/db.js`:
- Schema v9: `search_bookmarks` table (id, name UNIQUE, query, mode, created_at)

`src/bookmarks.js` (new):
- `add(name, query, mode)` — saves named search; validates mode ∈ {keyword, semantic, hybrid}; rejects duplicate names
- `list()` — returns all bookmarks sorted by name
- `get(name)` — returns bookmark by name or null
- `remove(id)` — deletes by id, returns change count

`src/server.js`:
- `GET /api/bookmarks`, `POST /api/bookmarks`, `DELETE /api/bookmarks/:id`
- Search tab: "★ Save" button to bookmark the current query; bookmark chips bar auto-appears when any bookmarks exist; click a chip to re-run; × to delete

`src/hive.js`:
- `hive bookmark list|add|run|remove`; `run` executes the saved query and prints results

`tests/test-phase32.js`: 10/10 passing
Full regression: 230/230 (Phases 10–32)

## 2026-11-20 — Phase 31 Complete

**Phase 31: Memory Linking**

`src/links.js` (new):
- `add(fromId, relType, toId, notes)` — creates a memory-to-memory relationship in the existing `relationships` table; validates both memory ids exist; accepted types: related, supports, contradicts, supersedes, predecessor, see-also
- `list(memoryId)` — returns all links where the memory appears on either side, with `from_title` / `to_title` joined in
- `remove(id)` — deletes by relationship id, returns change count

`src/server.js`:
- `GET /api/memories/:id/links` — list links for a memory
- `POST /api/memories/:id/links` — add link (`{to_id, rel_type, notes}`)
- `DELETE /api/links/:id` — remove a link
- Dashboard: "⇄ links" button on each card → modal with link list (direction arrow + colour-coded rel_type) and add-link form

`src/hive.js`:
- `hive link add <from> <rel_type> <to> [--notes "..."]`
- `hive link list --id <memory_id>`
- `hive link remove <link_id>`

`tests/test-phase31.js`: 10/10 passing
Full regression: 220/220 (Phases 10–31)

## 2026-11-20 — Phase 30 Complete

**Phase 30: Knowledge Stats Dashboard**

`src/stats.js` (new):
- `full()` — returns `{total, archived, entities, projects, byType, byTrust, byDomain, avgConf, avgImportance, growth}`
- `byType/byTrust/byDomain` — sorted DESC by count; domain capped at top 10
- `growth` — 30-entry dense array `[{day, count}]` with zero-fill for days with no additions

`src/server.js`:
- `GET /api/stats/full` — full knowledge-base stats
- Dashboard: Stats tab with totals cards (memories/archived/entities/projects/avgConf/avgImportance), 30-day growth sparkline (canvas, fill + stroke), and three CSS bar charts (by type, trust, domain)
- `loadKStats()` builds and renders all panels on demand

`src/hive.js`:
- `hive stats` — full CLI breakdown: totals, by-type, by-trust, by-domain, 30-day additions

`tests/test-phase30.js`: 10/10 passing
Full regression: 210/210 (Phases 10–30)

## 2026-11-20 — Phase 29 Complete

**Phase 29: Memory Templates**

`src/templates.js` (new):
- Six built-in templates keyed by `memory_type` (core, domain, project, episodic, semantic, skill)
- Each template carries: `title_hint`, `content_hint`, `trust_level`, `importance`, `confidence`, `tags`
- `list()` — returns all templates; `get(type)` — returns template for type, falls back to semantic

`src/server.js`:
- `GET /api/templates` — returns all template definitions
- Add modal type selector now fires `applyTemplate(type)` on change
- `applyTemplate()` — loads templates once (cached), pre-fills content, trust, importance, confidence and tags without overwriting user-entered values; no-ops during edits

`src/hive.js`:
- `hive template list` — shows all templates with defaults
- `hive template <type>` — shows full template including content hint

`tests/test-phase29.js`: 10/10 passing
Full regression: 200/200 (Phases 10–29)

## 2026-11-20 — Phase 28 Complete

**Phase 28: Tag Analytics**

`src/tags.js` (new):
- `topTags(limit=50)` — parses tags JSON from all active memories, returns `[{tag, count}]` sorted by frequency
- `coOccurrence(tag, limit=10)` — for memories containing a given tag, counts how often each other tag appears alongside it

`src/server.js`:
- `GET /api/tags/stats?limit=N&co=<tag>` — returns `{top:[{tag,count}], co:[{tag,count}], coTag}`
- Dashboard: Tags tab with interactive tag cloud (font-size scales with frequency, click filters Memories tab), top-15 ranked list, and debounced co-occurrence panel

`src/hive.js`:
- `hive tags [--top N] [--co <tag>]` — ranked tag list with optional co-occurrence section

`tests/test-phase28.js`: 10/10 passing
Full regression: 190/190 (Phases 10–28)

## 2026-11-20 — Phase 27 Complete

**Phase 27: Memory Versioning**

`src/db.js`:
- Schema v8: `memory_versions` table (id, memory_id, title, content, snapshot_at) with index on (memory_id, snapshot_at DESC)

`src/versions.js` (new):
- `snapshot(memoryId, title, content)` — saves pre-edit snapshot when title or content changes
- `list(memoryId)` — returns all versions newest-first (id, title, snapshot_at)
- `get(versionId)` — full version row including content
- `diff(textA, textB)` — LCS-based line diff returning `[{type:'add'|'del'|'eq', text}]`

`src/server.js`:
- `handleUpdateMemory`: auto-snapshots before any update that touches title or content
- `GET /api/memories/:id/versions` — list version history for a memory
- `GET /api/versions/:id/diff` — returns `{version, diff}` comparing snapshot to current content
- Dashboard: "⏱ history" button on each memory card → modal with version list + inline coloured diff

`src/hive.js`:
- `hive versions <memory_id>` — list version history
- `hive versions <memory_id> --diff <version_id>` — show line diff to current

`tests/test-phase27.js`: 10/10 passing
Full regression: 180/180 (Phases 10–27)

## 2026-11-20 — Phase 26 Complete

**Phase 26: Webhook Push Notifications**

`src/db.js`:
- Schema v7 migration: `webhooks` table (id, url UNIQUE, events JSON, active, created_at, last_triggered_at, last_status)

`src/webhooks.js` (new):
- `list()` — returns all webhooks with events parsed from JSON
- `add(url, events)` — validates http/https URL, inserts, returns row
- `remove(id)` — deletes by id, returns change count
- `fire(eventName, data)` — fire-and-forget POST to all active matching webhooks; 5s timeout; updates last_triggered_at and last_status; never throws to caller

`src/server.js`:
- `GET /api/webhooks` — list all webhooks
- `POST /api/webhooks` — register webhook (`{url, events}`)
- `DELETE /api/webhooks/:id` — remove webhook
- Webhooks fired on: `memory.created`, `memory.updated`, `memory.archived`
- Dashboard: Webhooks tab with register form (URL + events) and delete button

`src/hive.js`:
- `hive webhook list` — list registered webhooks
- `hive webhook add <url> [--events ev1,ev2]` — register webhook
- `hive webhook remove <id>` — delete webhook

`tests/test-phase26.js`: 10/10 tests passing
Full regression: 170/170 (Phases 10–26)

## 2026-11-20 — Phase 25 Complete

**Phase 25: Duplicate Detection**

`src/dedupe.js` (new):
- `tokenize(text)` — lowercases and extracts ≥3-char word tokens into a Set
- `jaccard(a, b)` — intersection / union on two word-token Sets
- `similarity(titleA, contentA, titleB, contentB)` — weighted score: title 60%, content 40%
- `findSimilar(title, content, {threshold=0.25, limit=5})` — compares against all active memories via `memory.list`, returns matches sorted by `_score` descending

`src/server.js`:
- `GET /api/memories/similar?title=...&content=...&threshold=0.25&limit=5` — returns `[{id, title, memory_type, score}]`; empty string → `[]`; registered in ROUTES before dynamic `:id` regex
- Dashboard add modal: duplicate warning panel (`id="nm-dup"`) with match list and purple border; appears if any match ≥ threshold before saving
- `submitAdd()` split into `_buildPayload()` + `_doSave()` + `saveAnyway()` — dedup check only on new memories (not edits)
- `saveAnyway()` skips dedup check and saves directly
- `closeAdd()` also hides the dup panel on cancel

`src/hive.js` — `hive memory add`:
- Checks `findSimilar` before inserting (threshold 0.25); prints warning with score + title + id prefix
- Exits 1 if duplicates found unless `--force` flag is passed

Tests: 10/10 passing (`tests/test-phase25.js`). All suites: **250/250 total**.

---

## 2026-11-20 — Phase 24 Complete

**Phase 24: Enhanced Graph Visualization**

`src/server.js` — `handleGraph`:
- `GET /api/graph?type=X` — filter nodes by entity_type
- `GET /api/graph?search=term` — filter nodes by name substring (case-insensitive LIKE)
- `type` + `search` can be combined
- Each node now includes `degree` (count of edges touching it); edges auto-excluded if endpoint filtered out

`src/server.js` — `loadGraph()` replacement (canvas, no external deps):
- **Degree-based node radius**: `r = 8 + min(degree×2, 10)` — hub entities appear larger
- **Scroll-wheel zoom + pan**: `gScale`/`gOffset` applied via canvas `save/translate/scale`
- **`fitGraph()`** button: resets scale to fit all nodes in view
- **Hover tooltip** (`id="g-tip"`): absolute-positioned div shows name, type, connection count on mousemove
- **Click to select / highlight subgraph**: selected node + its neighbours at full opacity; others dimmed to 20%; click again to deselect
- **Node info panel** (`id="g-info"`): shows selected node's name, type, degree, and all outgoing edges with rel_type + neighbour name
- **Edge labels**: rel_type drawn at edge midpoints when zoom ≥ 0.7
- **Selected edge highlight**: edges touching the selected node drawn in `#58a6ff`, 2px
- **Cooling factor**: simulation slows after ~300 ticks for a stable layout
- **Graph controls bar**: search input (`id="g-search"`), type filter (`id="g-type"`), Refresh, Fit, node/edge count (`id="g-count"`)

Tests: 10/10 passing (`tests/test-phase24.js`). All suites: **240/240 total**.

---

## 2026-11-20 — Phase 23 Complete

**Phase 23: Memory Confidence Scores**

`src/memory.js`:
- `memory.list()` gains `min_conf` and `max_conf` optional params → SQL `confidence >= ?` / `<= ?` filters
- `memory.update()` already accepted `confidence`; `memory.add()` already defaulted to 0.5 — both now documented/tested

`src/server.js`:
- `handleMemories`: passes `min_conf`/`max_conf` from query string to `memory.list()`
- `handleUpdateMemory`: clamps `confidence` to [0,1] before updating
- `handleAddMemory`: clamps `confidence` to [0,1]; defaults to 0.5
- Dashboard: `confBar(c)` renders a coloured percentage + mini bar (green ≥0.8, amber ≥0.5, red <0.5)
- Dashboard `card()`: confidence bar shown before type/trust badges
- Dashboard Memories tab: `<select id="mconf">` with "Any / ≥0.8 / ≥0.6 / ≤0.4" options; `loadMem()` reads `min_conf`/`max_conf`
- Dashboard modal: `<input id="nm-cf">` confidence field; `showAdd`/`showEdit`/`submitAdd` wired up

`src/hive.js`:
- `hive memory update <id> --confidence 0.9` now accepted; clamped to [0,1]

Tests: 10/10 passing (`tests/test-phase23.js`). All suites: **230/230 total**.

---

## 2026-11-20 — Phase 22 Complete

**Phase 22: REST API Key Authentication**

`src/apikeys.js` (new):
- `generate(name)` — creates a `hive_<48-hex>` key, stores SHA-256 hash in DB, returns plain key once
- `verify(key)` — hashes and checks against DB, stamps `last_used_at` on match
- `list()` — returns all keys (id, name, created_at, last_used_at); never returns key hashes
- `revoke(name)` — deletes by name, returns change count
- `hasAny()` — boolean gate: open mode vs. auth mode

`src/db.js` — schema v6: `api_keys` table (id, name, key_hash UNIQUE, created_at, last_used_at)

`src/server.js`:
- `checkAuth(req, pathname)` — middleware: open mode if no keys exist; `/api/*` requires `Authorization: Bearer <key>` unless `X-Hive-Local: 1` is present (dashboard fetches); `GET /` always passes
- `GET /api/apikeys` — list keys
- `POST /api/apikeys` — create key; returns `{key}` once
- `DELETE /api/apikeys/:name` — revoke key
- Dashboard "API Keys" tab: list table with created/last-used times and Revoke button; Generate form with one-time key display and Copy button; `X-Hive-Local: 1` on all dashboard fetches

`src/hive.js` — `hive apikey [list|create|revoke]` CLI commands

Tests: 10/10 passing (`tests/test-phase22.js`). All suites: **220/220 total**.

---

## 2026-11-20 — Phase 21 Complete

**Phase 21: Bulk Operations**

`src/server.js`:
- `POST /api/memories/bulk` — accepts `{ids, action, updates}`; supports `action:'archive'` (sets status=archived) and `action:'update'` (applies `updates` fields to all ids); returns `{count}` of successful ops; silently skips missing ids; validates ids array and action present (400 on failure)
- Route added to exact-match ROUTES table (before dynamic regex) to prevent collision with `/api/memories/:id`
- Dashboard Memories tab: bulk-select toolbar (`id="bulk-bar"`, hidden until selection) with selected-count badge, Archive button, memory-type dropdown, Apply type button, Clear button
- Each memory card gets a checkbox (`onchange="toggleSel(id, checked)"`); toolbar appears/hides with selection size
- `toggleSel(id, on)`: adds/removes from `_sel` Set, updates toolbar visibility and count
- `clearSelection()`: clears `_sel`, unchecks all card checkboxes, hides toolbar
- `bulkArchive()`: POSTs archive action for all selected ids, refreshes list and stats
- `bulkRetype()`: POSTs update action with `{memory_type}` for all selected ids, refreshes list
- `loadMem()` clears selection on each load

Tests: 10/10 passing (`tests/test-phase21.js`). All suites: **210/210 total**.

---

## 2026-11-20 — Phase 20 Complete

**Phase 20: Activity Feed**

`src/server.js`:
- `GET /api/activity?limit=N` — reads `audit_log` LEFT JOIN `memories`, returns events newest-first with `action`, `entity_type`, `entity_id`, `title` (for memory events), `details` (parsed JSON), `timestamp`, and `time_ago` (human-readable: "5s ago", "3m ago", "2h ago", "1d ago")
- Dashboard "Activity" tab: timeline cards with per-action icons (✚ CREATE, ✎ UPDATE, ✕ DELETE, ↑ REINFORCE), memory title linked, action/type badges, relative time

Tests: 10/10 passing (`tests/test-phase20.js`). All suites: **190/190 total**.

---

## 2026-11-20 — Phase 19 Complete

**Phase 19: Memory Tags UI**

`src/server.js`:
- `GET /api/tags` — all unique tags across active memories with per-tag counts, sorted by count desc
- `GET /api/memories?tag=X` — filters results to memories containing that tag
- `POST /api/memories` — tags array already accepted; now surfaced in modal
- `PUT /api/memories/:id` — tags now included in updatable fields
- Dashboard Memories tab: `<select id="mtag">` tag filter populated by `loadTagSelect()`; refreshed after add/edit
- Dashboard Add/Edit modal: Tags field (comma-separated input `nm-tg`), pre-filled on edit
- Memory cards: tags rendered as clickable `#tag` chips — clicking calls `filterTag()` to switch to Memories tab filtered by that tag
- `filterTag(tag)`: sets mtag and switches to Memories tab

Tests: 10/10 passing (`tests/test-phase19.js`). All suites: **180/180 total**.

---

## 2026-11-20 — Phase 18 Complete

**Phase 18: Search History**

`src/db.js`:
- Schema v5 migration: `search_history` table (id, query, searched_at) + index on query

`src/server.js`:
- `recordQuery(query)` — called on every non-empty search, inserts into `search_history`
- `GET /api/search/history?limit=N` — returns recent unique queries grouped by query, ordered by `last_used DESC`, with `times` count
- Dashboard Search tab: `<input list="q-history">` + `<datalist id="q-history">` for native browser autocomplete
- `loadHistory()` — populates datalist on page load and after each search

Tests: 10/10 passing (`tests/test-phase18.js`). All suites: **170/170 total**.

---

## 2026-11-20 — Phase 17 Complete

**Phase 17: Export Formats**

`src/export.js`:
- `exportJson()` — all active memories as a pretty-printed JSON array; tags parsed to arrays
- `exportCsv()` — all active memories as CSV (id, title, memory_type, domain, trust_level, importance, status, timestamps, content); double-quotes escaped per RFC 4180

`src/hive.js`:
- `hive export [--format json|csv|md] [--out <file>]` — JSON/CSV go to stdout (or file via `--out`); MD still writes to `memory/` as before

`src/server.js`:
- `GET /api/export?format=json|csv` — download endpoint with `Content-Disposition: attachment` and correct MIME type
- Dashboard header: ⬇ JSON and ⬇ CSV download links (native `<a download>` — no JS needed)

Tests: 10/10 passing (`tests/test-phase17.js`). All suites: **160/160 total**.

---

## 2026-11-20 — Phase 16 Complete

**Phase 16: Review Digest**

`src/hive.js`:
- `hive review [--limit N] [--project <id>]` — Markdown-formatted digest grouped into Critical (>90d idle), Warning (30–90d), and Recent (<30d) sections

`src/server.js`:
- `GET /api/review?limit=N&project=...` — returns stalest memories with `days_idle` and `urgency` fields (critical/warning/ok)
- `POST /api/memories/:id/reinforce` — bumps importance +1, updates `last_accessed_at`
- Dashboard "Review" tab: color-coded cards (red/yellow/green border), inline "↑ reinforce" and "× archive" buttons; `loadReview()` auto-loads on tab switch
- `reinforceMem(id, btn)` — calls reinforce endpoint, disables button on success

Tests: 10/10 passing (`tests/test-phase16.js`). All suites: **150/150 total**.

---

## 2026-11-20 — Phase 15 Complete

**Phase 15: Project Dashboard**

`src/server.js`:
- `GET /api/projects/:id/stats` — returns project fields + `memory_count` (active only) + `entity_count` (via entity links)
- Dynamic routing extended to match `/api/projects/:id/stats`
- Dashboard "Projects" nav button + tab: project cards with memory/entity counts, objective preview, "→ memories" click-through
- `loadProjects()`: fetches all projects, enriches each with stats via parallel `/api/projects/:id/stats` calls
- `viewProject(id)`: sets `mproj` select and switches to Memories tab, filtered to that project

Tests: 10/10 passing (`tests/test-phase15.js`). All suites: **140/140 total**.

---

## 2026-11-20 — Phase 14 Complete

**Phase 14: Semantic Search Toggle**

`src/server.js`:
- `GET /api/search?mode=keyword|semantic|hybrid` — `mode` param selects search engine
  - `keyword` (default): existing FTS5 BM25 search, always available
  - `semantic`: cosine similarity via `semantic.js` (requires embeddings; falls back to keyword if not loaded)
  - `hybrid`: 60% cosine + 40% normalised importance via `semantic.js` (same fallback)
- Dashboard Search tab: added `<select id="smode">` (Keyword / Hybrid / Semantic) next to the search button
- `doSearch()` reads `smode` and appends `&mode=...` to the API call

Tests: 10/10 passing (`tests/test-phase14.js`). All suites: **130/130 total**.

---

## 2026-11-20 — Phase 13 Complete

**Phase 13: Memory Editing**

`src/server.js`:
- `GET /api/memories/:id` — fetch a single memory by id (404 if not found)
- `PUT /api/memories/:id` — update title/content/memory_type/trust_level/importance (400 on empty body, 404 if not found)
- Consolidated dynamic routing: one regex match handles GET/PUT/DELETE for `/api/memories/:id`
- Dashboard "✎ edit" button on every memory card — fetches the memory, opens the shared Add/Edit modal pre-filled
- Add/Edit modal is now dual-mode: POST when adding, PUT when editing (`_editId` toggle)

`src/memory.js`:
- Added `memory_type` to the `ALLOWED` update fields in `update()` — was previously blocked silently

Tests: 10/10 passing (`tests/test-phase13.js`). All suites: **130/130 total**.

---

## 2026-11-20 — Phase 12 Complete

**Phase 12: Markdown Import**

`src/importer.js`:
- `parseMd(content, filePath)` — extracts title (frontmatter → H1 → filename), body, type, trust, importance, tags from any markdown file; optional YAML frontmatter (`---` block)
- `importFile(filePath, { auto, overrides })` — dry-run or write; deduped via `source_ref = md:<abs-path>`; skips empty files and already-imported files
- `importDir(dirPath, { auto, limit, overrides })` — batch-imports all `.md`/`.markdown` files in a directory (non-recursive); returns `{ proposals, stored, skipped }`

CLI:
- `hive import <file.md> [--auto] [--type TYPE] [--trust LEVEL] [--importance N]`
- `hive import <directory> [--auto] [--limit N]` — bulk import a folder of notes

Tests: 10/10 passing (`tests/test-phase12.js`). All suites: **120/120 total**.

---

## 2026-11-20 — Phase 11 Complete

**Phase 11: Graph Visualization**

`src/server.js`:
- `GET /api/graph?limit=N` — returns `{ nodes: [...], edges: [...] }` from the entities + relationships tables; edges filtered to only reference returned nodes
- Dashboard "**Graph**" tab: pure-canvas force-directed graph, no CDN dependency
  - Spring physics: node repulsion (3000/d²) + edge attraction (rest length 120) + center gravity
  - Color-coded by entity type (8 types), legend auto-built from returned data
  - Drag nodes to reposition; `requestAnimationFrame` loop stopped when leaving tab
  - Label truncation at 18 chars; empty-state message when no entities exist

Tests: 10/10 passing (`tests/test-phase11.js`). All suites: **110/110 total**.

---

## 2026-11-20 — Phase 10 Complete

**Phase 10: Write API + Auto-embed**

`src/server.js`:
- `POST /api/memories` — create a memory from the browser (returns 201 + full memory object)
- `DELETE /api/memories/:id` — archive a memory (soft delete, sets status=archived)
- Input validation: 400 if title or content missing
- Dynamic route dispatch for `DELETE /api/memories/:id`
- Dashboard: "+ Add Memory" button in Memories tab → modal form (title, content, type, trust, importance)
- Dashboard: "× archive" button on each memory card — removes card on success, refreshes stats
- Inline validation in modal (no browser `alert()`)

`src/memory.js`:
- Auto-embed on `memory.add()` — fire-and-forget `semantic.embedMemory(m)`, soft dependency (never blocks the add, fails silently without the model)

Tests: 10/10 passing (`tests/test-phase10.js`). All suites: **100/100 total**.

---

## 2026-11-20 — Phase 9 Complete

**Phase 9: Web Dashboard**

`src/server.js`:
- Local HTTP server on port 7749 (`hive serve [--port N]`)
- 8 JSON API endpoints: `/api/stats`, `/api/search`, `/api/memories`, `/api/patterns`, `/api/entities`, `/api/projects`, `/api/brief`, plus `/` for the HTML dashboard
- Brief endpoint serves cached `database/last-briefing.md` if present, else calls `dailyBriefing()`
- Embedded single-page dashboard: Search, Memories (filterable by type/trust/project), Briefing, Patterns (bar chart), Entities tabs
- `createServer()` exported as factory for test lifecycle control (port 0 → OS-assigned)
- Uses WHATWG `URL` API — no `url.parse()` deprecation warning

`src/hive.js`: added `hive serve [--port N]` command

Tests: 10/10 passing (`tests/test-server.js`). All suites: **90/90 total**.

---

## 2026-11-20 — Phase 8 Complete

**Phase 8: Entity Extraction / Auto-tagging**

`src/extract.js`:
- `detectMentions(text)`: scans all entities (names + aliases), word-boundary regex, skips names < 3 chars, confidence = `min(0.9, 0.3 + name_length × 0.05)`
- `extractAndLink(memoryId, { title, content })`: persists detected entities to `memory_entity_links`
- `linkedEntities(memoryId)`: entities linked to a memory, sorted by confidence
- `linkedMemories(entityId, { limit })`: active memories mentioning an entity
- `backfill({ limit })`: processes memories without any entity links — safe to re-run (idempotent via `NOT EXISTS` check)

`src/db.js`: schema v4 migration adds `memory_entity_links` table + `idx_mel_entity` index

`src/memory.js`: auto-calls `extractAndLink` inside `add()` after every save — soft dependency (exception caught, never blocks write)

CLI:
- `hive extract <memory_id>` — detect and show entity mentions for one memory
- `hive extract --all [--limit N]` — backfill all un-linked memories
- `hive memory links <memory_id>` — show entities linked to a memory
- `hive entity links <entity_id>` — show memories mentioning an entity

Tests: 10/10 passing (`tests/test-extract.js`). All suites: 80/80 total. Git: 3f18139

**Next**: Phase 9 candidate — Web dashboard (browse memories, graph, briefings in browser) or REST API layer

---

## 2026-11-19 — Phase 7 Complete

**Phase 7: Smart Briefings**

`src/briefing.js` — `generateBriefing(task, { projectId, budget, embedFn })`:
- Merges FTS5 keyword results (from `search.js`) + semantic results (from `semantic.js`), deduplicated by id
- Propagates `_sim` onto KW-matched entries found in semantic results — so combined score uses both signals
- Re-ranks: 40% keyword position + 40% cosine similarity + 20% decay score
- Minimum similarity threshold (0.1) drops truly orthogonal semantic results
- Budget enforcement: stops appending memory entries once `tokenEstimate > budget` (default 1500 tokens)
- "Needs Review" section: `stalest()` top 3 memories not touched in 14+ days, not already surfaced
- Returns `{ text, tokenEstimate, memoryCount, staleCount }`

`dailyBriefing({ projectId, budget, embedFn })` — infers topic from `topKeywords({ days: 7 })`, delegates to `generateBriefing`.

CLI:
- `hive brief "<task>"  [--project <id>] [--budget N]` — task-focused briefing
- `hive brief --daily                                 ` — topic inferred from last 7 days

`hooks/session-capture.js` — saves daily briefing to `database/last-briefing.md` on session stop so next session finds a ready context pack.

Tests: 10/10 passing (`tests/test-briefing.js`). All suites: 70/70 total. Git: 932b901

**Next**: Phase 8 — Entity extraction / auto-tagging, or UI dashboard (TBD)

---

## 2026-11-19 — Phase 6 Complete

**Phase 6: Semantic Search**

`src/embeddings.js` — model wrapper:
- Model: `Xenova/all-MiniLM-L6-v2` via `@huggingface/transformers` v4 (pure JS/WASM, ~23 MB, downloads once)
- Disk cache: `database/embeddings/<hash>.json` — avoids re-embedding unchanged content
- `embed(text)` — raw model call; `embedCached(text)` — cache-first; `embedMemory(m)` — stores in DB

`src/semantic.js` — vector search:
- `cosine(a, b)` — cosine similarity; zero-safe, handles unit-normalized vectors
- `search(query, { limit, projectId, hybrid, embedFn })` — similarity-ranked results; `hybrid` blends 60% cosine + 40% normalised importance
- `backfill({ embedFn, limit })` — batch-embeds all memories missing an embedding

`src/db.js` — schema v3 migration: `embedding TEXT` column on memories (JSON-encoded float array)

CLI:
- `hive semantic "<query>"` — semantic similarity search
- `hive embed backfill` — index all memories (downloads model on first run)

Dependency upgrade: `better-sqlite3` bumped from `^11.10.0` to `^12.1.0` (v12.1.0 is first release with prebuilt binaries for Node.js 24 / ABI 137)

Tests: 10/10 passing (`tests/test-semantic.js`) using deterministic 4-dim mock embeddings. All suites: 60/60 total.

**Next**: Phase 7 — Smart Briefings (session-start context pack, proactive surfacing of relevant memories)

---

## 2026-11-19 — Phase 5 Complete

**Phase 5: Learning System**

`src/decay.js` — recency-weighted score and idle sweep:
- `decayScore(memory)`: `importance / (1 + days_idle / 30)` — halves every 30 idle days
- `sweep()`: marks active memories idle 90+ days as OUTDATED; skips USER_CONFIRMED
- `stalest({ projectId, limit })`: memories sorted by decay score ascending (most forgotten first)

`src/reinforce.js` — access tracking:
- `reinforce(id)`: bumps importance +1 (max 10), updates `last_accessed_at`
- `touch(id)`: records access time without changing importance (called auto by search)

`src/patterns.js` — keyword frequency:
- `topKeywords({ days, limit, projectId })`: sliding-window word frequency over recent memories, stop-word filtered

`src/db.js` — schema v2 migration adds `last_accessed_at INTEGER` to memories table

`src/search.js` — auto-calls `touch()` on every search result so retrieval feeds decay tracking

CLI:
- `hive suggest` — stalest memories ranked by decay score
- `hive patterns` — top recurring keywords with bar chart
- `hive reinforce <id>` — manually bump a memory
- `hive decay sweep` — run the 90-day idle sweep

Tests: 10/10 passing (`tests/test-learning.js`). All suites: 50/50 total.

**Next**: Phase 6 — Semantic Search (vector embeddings via transformers.js or Python bridge)

---

## 2026-11-19 — Phase 4 Complete

**Phase 4: Session Capture & Ingestion**

`src/ingest.js` — two ingestion paths:
- `parseSession(jsonlPath)`: reads Claude Code JSONL transcripts; strips `<system-reminder>` from user content; skips `thinking` blocks; filters assistant text under 10 chars
- `extractProposals(turns)`: filler-message filter (continue/go ahead/ok/etc.); SIGNAL_PATTERNS regex (decided, root cause, fixed, architecture, must be, etc.); NOISE_PREFIXES filter (Let me, I'll, Running, etc.); returns ranked proposals
- `fromSession(jsonlPath, { auto, projectId, maxProposals })`: dedup via `source_ref = session:<id>:<djb2hash>`; dry-run by default
- `fromClaudeMem({ project, limit, auto, projectId })`: reads `~/.claude-mem/claude-mem.db` readonly; maps observation types to HIVE memory types; dedup via `source_ref = claude-mem:<id>`

`hooks/session-capture.js` — Claude Code Stop hook:
- Derives JSONL path from `CLAUDE_SESSION_ID` + `CLAUDE_PROJECT_DIR` env vars
- Falls back to scanning `~/.claude/projects/` if no PROJECT_DIR
- Calls `fromSession(..., { auto: true, maxProposals: 10 })`

`hive session import <path>  [--auto] [--project <id>] [--limit N]`
`hive ingest  [--project <name>] [--limit N] [--auto] [--project-id <id>]`

Tests: 10/10 passing (`tests/test-ingest.js`). All suites: 40/40 total.

**Next**: Phase 5 — Learning System (decay, reinforcement, pattern detection, smart suggestions)

---

## 2026-11-19 — Phase 3 Complete

**Phase 3: Knowledge Graph**

`src/entities.js` — entity CRUD:
- 8 entity types: person, tool, org, concept, project, file, domain, other
- `findByName()`: case-insensitive fuzzy search on name + JSON aliases array; exact name ranks first
- `merge(keepId, dropId)`: reroutes all relationships from dropped entity to kept entity, then deletes it

`src/graph.js` — relationship CRUD + traversal:
- `link({ from_id, rel_type, to_id, ... })`: creates typed directed relationship (validates both endpoints)
- `neighbors(entityId, { direction, relType, limit })`: adjacent entities with rel metadata; supports out/in/both + relType filter
- `relatedMemories(entityId)`: FTS5 search across all memories using entity name and aliases

`hive entity add/get/list/find/link/merge`, `hive graph neighbors/related` — new CLI commands

Tests: 10/10 passing (`tests/test-graph.js`). All suites: 30/30 total. Git: 183f7be

**Next**: Phase 4 — Session Capture (hook-based capture, claude-mem ingestion)

---

## 2026-11-19 — Phase 2 Complete

**Phase 2: Retrieval Engine / Context Router**

`src/context.js` — `buildContext(task, { projectId, budget, crossProject })`:
- Domain detection from task keywords (4 domains: data-analytics, software-engineering, professional-work, personal)
- Project identification via stop-word-filtered substring scoring against name/objective
- 4 retrieval layers ranked by source weight × confidence × importance × recency
- Recency decay: `1/(1 + days/30)` — half-life 30 days
- Token budget enforcement (default 2000 tokens, project header reserved)
- Ambiguity detection: second candidate within 50% of top score → `ambiguous_project` warning
- Output: `{ task, domain, project, memories, skills, warnings, tokenEstimate, budget }`

`hive context "<task>"` CLI command — pretty-print + `--json` flag for programmatic use.

Bugs fixed during Phase 2:
- `_scoreProject` removed domain field from haystack → prevents 'work' matching 'professional-work'
- Added STOP_WORDS filter → 'the' in query no longer pollutes project scoring
- Ambiguity threshold lowered 70% → 50% → adjacent-score projects correctly surface warning

Tests: 10/10 passing (`tests/test-context.js`). All Phase 1 tests still 10/10. Git: f1590e0

**Next**: Phase 3 — Knowledge Graph (entities, relationships, provenance)

---


## 2026-11-19 — Phase 1 Complete

**Phase 1: Core Foundation**

SQLite schema (hive.db): memories, projects, entities, relationships, sources, audit_log + FTS5 virtual table with porter/unicode61 tokenizer and sync triggers.

Node.js CLI (`node src/hive.js`):
- `memory add/get/update/delete/list`
- `search "<query>"` — FTS5 BM25 with OR-join for natural-language queries + LIKE fallback
- `project create/list/get/update`
- `export` — all active memories → Markdown files
- `backup` — WAL checkpoint + timestamped SQLite copy

Security: 8-pattern credential scanner blocks secrets before ingestion. Audit log to SQLite + file.

Markdown sync: memories with importance ≥ 7 auto-synced to `memory/<type>/` on write.

Tests: 10/10 passing. Git: 2a2aac1

**Next**: Phase 2 — Context Router (`hive context "<task>"`)

---

## 2026-11-19 — Phase 0 Complete

**Phase 0: Research & Environment Audit**

Environment audited:
- Windows 10 Pro 10.0.19045
- Node.js 24.17.0, Python 3.13.14, Git 2.55.0, SQLite 3.53.4
- pip available via `python -m pip` (not on PATH directly)
- 331 GB free disk

Repos researched and evaluated (5 candidates — all rejected as HIVE foundation):
- thedotmack/claude-mem: 118k stars, Windows-explicit, role = feeder not foundation
- topoteretes/cognee: 33k stars, complex, deferred to Phase 2+ consideration
- getzep/graphiti: 33k stars, requires external graph DB, deferred
- oliverhees/graphiti-mem: 1 star, too early, skipped
- ConnorCallahan01/cogni-code: 3 stars, no semantic search, skipped

Architecture decided: SQLite + Node.js + Markdown (ADR-001 through ADR-005)

Documentation created:
- CLAUDE.md, README.md, .gitignore
- PROJECT_STATE.md, ROADMAP.md, NEXT_ACTIONS.md, DECISIONS.md
- docs/RESEARCH.md, docs/ARCHITECTURE.md, docs/TECH_STACK.md, docs/SECURITY.md
- Full directory structure

Git repo initialized.

**Next**: Phase 1 — Core Foundation (pending user approval)
