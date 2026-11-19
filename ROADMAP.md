# HIVE Roadmap

## Phase 0 — Research & Environment Audit ✅ COMPLETE (2026-11-19)

Deliverables:
- [x] Environment audit (Windows 10, Node 24, Python 3.13, SQLite 3.53, Git 2.55)
- [x] Research: 5 candidate repos evaluated
- [x] Architecture decision: SQLite + Node.js + Markdown
- [x] docs/RESEARCH.md
- [x] docs/ARCHITECTURE.md
- [x] docs/TECH_STACK.md
- [x] docs/SECURITY.md
- [x] ROADMAP.md, PROJECT_STATE.md, NEXT_ACTIONS.md
- [x] Git repo initialized

## Phase 1 — Core Foundation 🔲 NEXT

Goal: Working HIVE CLI — create/read/update/delete memories, project management, export, backup.

Tasks:
- [ ] Initialize SQLite schema (hive.db): memories, projects, entities, sources tables
- [ ] FTS5 virtual tables for full-text search
- [ ] `src/db.js` — SQLite connection and schema management
- [ ] `src/memory.js` — memory CRUD
- [ ] `src/projects.js` — project CRUD
- [ ] `src/hive.js` — CLI entry point
- [ ] Commands: `hive memory add/get/update/delete/list`
- [ ] Commands: `hive project create/list/get/status`
- [ ] Commands: `hive search "<query>"`
- [ ] Commands: `hive export`, `hive backup`, `hive restore`
- [ ] Markdown sync: write memories to `memory/` dirs
- [ ] Trust/confidence system (USER_CONFIRMED → OUTDATED states)
- [ ] Test suite: 10 baseline tests from spec
- [ ] `package.json` with minimal dependencies

## Phase 2 — Retrieval Engine 🔲

Goal: Context router — assemble a relevant context pack for a given task.

Tasks:
- [ ] `src/search.js` — FTS5 search + ranking
- [ ] Semantic/vector search (transformers.js or Python bridge)
- [ ] `src/context.js` — context router
- [ ] `hive context "<task description>"` command
- [ ] Domain detection
- [ ] Project identification
- [ ] Memory ranking (relevance + recency + confidence)
- [ ] Context budget enforcement
- [ ] Ambiguity detection

## Phase 3 — Knowledge Graph 🔲

Goal: Relationship layer connecting memories, projects, entities, decisions.

Tasks:
- [ ] `entities` table (people, tools, orgs, concepts)
- [ ] `relationships` table (entity, type, target, valid_from, valid_until)
- [ ] `src/graph.js` — relationship CRUD and traversal
- [ ] Entity deduplication
- [ ] Temporal relationship support
- [ ] `hive entity add/link/query`
- [ ] Upgrade path documented: FalkorDB Lite if SQLite graph becomes limiting

## Phase 4 — Session Capture 🔲

Goal: Automatically capture useful knowledge from Claude Code sessions.

Tasks:
- [ ] Research current Claude Code hook capabilities (PostToolUse, Stop, etc.)
- [ ] Hook-based session capture to `logs/sessions/`
- [ ] Session metadata indexer
- [ ] Memory extraction from session logs (decisions, corrections, project state changes)
- [ ] Project state auto-update at session end
- [ ] claude-mem observation ingestion into HIVE
- [ ] Compaction recovery test

## Phase 5 — Learning System 🔲

Goal: Extract validated knowledge from sessions, detect corrections, manage confidence.

Tasks:
- [ ] Importance scoring
- [ ] Duplicate detection
- [ ] Contradiction detection
- [ ] Memory consolidation (merge duplicates, archive stale)
- [ ] Correction capture workflow
- [ ] Skill candidate generation
- [ ] Learning history log

## Phase 6 — Skills 🔲

Goal: Reusable skill library, discoverable by task intent.

Tasks:
- [ ] `skills` table with full schema (see spec)
- [ ] Skill search by intent (not just name)
- [ ] Trigger matching
- [ ] Skill promotion workflow (from observed episode to validated skill)
- [ ] Skill versioning
- [ ] `hive skill add/list/search/validate`

## Phase 7 — Personal Assistant 🔲

Goal: Natural-language interaction layer over HIVE.

Tasks:
- [ ] Task understanding
- [ ] Context routing (uses Phase 2 router)
- [ ] Tool integration
- [ ] Project management via conversation
- [ ] Research queries

## Phase 8 — Autonomy 🔲

Goal: Background maintenance, proactive insights. Only after Phase 1-6 are reliable.

Tasks:
- [ ] Background consolidation scheduler
- [ ] Contradiction monitoring
- [ ] Stale memory detection
- [ ] Proactive suggestions (opt-in)
- [ ] All autonomous behaviors have disable switches and audit logs

---

Priority order: Reliability → Memory integrity → Retrieval accuracy → Context isolation →
Knowledge ownership → Security → Learning → Automation → Autonomy
