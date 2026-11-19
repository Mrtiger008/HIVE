# CHANGELOG.md

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
