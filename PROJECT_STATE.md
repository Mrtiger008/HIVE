# PROJECT_STATE.md

Last updated: 2026-11-19

## Current Phase

Phase 0 — COMPLETE  
Phase 1 — Core Foundation — COMPLETE (2026-11-19)  
Phase 2 — Retrieval Engine — COMPLETE (2026-11-19)  
Phase 3 — Knowledge Graph — COMPLETE (2026-11-19)  
Phase 4 — Session Capture — COMPLETE (2026-11-19)
Phase 5 — Learning System — COMPLETE (2026-11-19)
Phase 6 — Semantic Search — COMPLETE (2026-11-19)
Phase 7 — Smart Briefings — COMPLETE (2026-11-19)
Phase 8 — Entity Extraction / Auto-tagging — COMPLETE (2026-11-20)
Phase 9 — Web Dashboard — COMPLETE (2026-11-20)
Phase 10 — Write API + Auto-embed — COMPLETE (2026-11-20)
Phase 11 — Graph Visualization — COMPLETE (2026-11-20)
Phase 12 — Markdown Import — COMPLETE (2026-11-20)

## Architecture (decided)

**Storage layer**
- SQLite (`database/hive.db`) — all structured data, metadata, relationships, search
- Markdown files (`memory/`) — human-readable mirror of important memories
- Git — versioning of everything in this repo

**Engine**
- Node.js (`src/`) — CLI and core logic
- SQLite FTS5 — full-text search (built into SQLite, no install needed)
- No external services required for Phase 1

**Deferred**
- Semantic/vector search: Phase 2 (transformers.js or Python-based, TBD)
- Knowledge graph: Phase 3 (SQLite relationships table → FalkorDB Lite upgrade path)
- UI: Phase 7+

**claude-mem relationship**
claude-mem (already installed as MCP) captures session observations.
HIVE is the structured knowledge base. Phase 4 will ingest claude-mem observations into HIVE.
They coexist, don't duplicate.

## Environment

- OS: Windows 10 Pro 10.0.19045
- PowerShell 5.1
- Git 2.55.0
- Node.js 24.17.0, npm 11.13.0
- Python 3.13.14, pip 26.1.2 (via `python -m pip`)
- Claude Code 2.1.296
- SQLite 3.53.4
- Free disk: 331 GB

## What Exists

- Full directory structure
- Phase 0 docs: RESEARCH.md, ARCHITECTURE.md, TECH_STACK.md, SECURITY.md
- Phase 1 engine: src/db.js, src/memory.js, src/projects.js, src/search.js, src/security.js, src/audit.js, src/export.js, src/hive.js
- Tests: tests/test.js — 10/10 passing
- Working CLI: `node src/hive.js help`
- Git: 2 commits (c38aff3 Phase 0, 2a2aac1 Phase 1)

## CLI Quick Reference

```
node src/hive.js memory add  --title "..." --content "..." --type semantic --trust OBSERVED --importance 5
node src/hive.js search "natural language query"
node src/hive.js project create --name "..." --domain "..."
node src/hive.js backup
node src/hive.js export
node src/hive.js help
```

## Known Issues / Technical Debt

- pip not on PATH directly — must use `python -m pip` or `py -m pip`
- SQLite is 32-bit (system install) — may want 64-bit for large DBs later
- PowerShell 5.1 (not 7) — some cmdlets differ, avoid 7-only syntax

## Git Status

Initial commit — Phase 0 documentation only.
