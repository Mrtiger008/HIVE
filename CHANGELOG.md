# CHANGELOG.md

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
