# DECISIONS.md

Architecture decision records (ADR) for HIVE.

---

## ADR-001: Primary storage — SQLite + Markdown

**Date**: 2026-11-19  
**Status**: Accepted

**Decision**: Use SQLite as the primary structured store with Markdown files as the human-readable layer.

**Rationale**:
- SQLite is already installed on the system (3.53.4), zero new installs
- FTS5 (full-text search) is built into SQLite — no separate search engine needed for Phase 1
- Markdown files are readable without any application, git-friendly, exportable
- 331 GB free disk — no size concerns
- Avoids mandatory cloud services

**Rejected alternatives**:
- PostgreSQL: overkill, requires server process
- Neo4j: external process, complex Windows setup
- Plain JSON files: no search capabilities built in
- ChromaDB: Python-based, adds complexity before core is built

---

## ADR-002: Primary engine language — Node.js

**Date**: 2026-11-19  
**Status**: Accepted

**Decision**: Build the HIVE CLI in Node.js (not Python).

**Rationale**:
- Node.js 24.17.0 confirmed working, `better-sqlite3` is the best SQLite binding available
- Python pip is not on PATH (must use `python -m pip`) — adds friction for scripts
- Claude Code itself runs on Node.js — tighter integration later
- Python can still be used for specific tasks (e.g., ML/embeddings in Phase 2) via subprocess

**Note**: Python is NOT excluded — it will be used for semantic search in Phase 2.

---

## ADR-003: Reject all 5 candidate repos as HIVE foundation

**Date**: 2026-11-19  
**Status**: Accepted

**Decision**: Build HIVE custom. Do not adopt claude-mem, cognee, graphiti, graphiti-mem, or cogni-code as the foundation.

**Rationale**:
- **claude-mem (thedotmack)**: Already installed as session observer. Good for feeding data INTO HIVE. Not the right architecture to build HIVE on top of — it's an observation capture system, not a full knowledge store. Freemium model, crypto token association.
- **cognee**: Powerful but high complexity (755 open issues, complex Python install, `dlt` dep, Postgres optional). Better used as a potential Phase 2+ component if the custom approach hits limits.
- **graphiti**: Requires external graph DB (Neo4j or FalkorDB via Docker). Not zero-install on Windows.
- **graphiti-mem**: 1 star, 0 forks, 7 commits. Requires two external API services (Anthropic + Voyage AI). Skip.
- **cogni-code**: 3 stars. No semantic search. Not community-validated.

**Upgrade path**: If Phase 2-3 requirements exceed what SQLite can serve, evaluate FalkorDB Lite (embedded, Python 3.12+) for graph and transformers.js or cognee for semantic search.

---

## ADR-004: claude-mem role — feeder, not core

**Date**: 2026-11-19  
**Status**: Accepted

**Decision**: claude-mem remains installed as a session observation system. Phase 4 will build an ingestion bridge to pull claude-mem observations into HIVE's structured knowledge base.

They coexist:
- claude-mem: captures what happens in AI sessions (skill observations)
- HIVE: structured, queryable, long-term knowledge base

---

## ADR-005: Knowledge graph — SQLite relationships table, FalkorDB Lite upgrade path

**Date**: 2026-11-19  
**Status**: Accepted

**Decision**: Phase 3 graph = `relationships` table in hive.db. Upgrade to FalkorDB Lite (embedded, no server, Python 3.12+) if graph traversal performance becomes limiting.

**Rationale**: Avoids Docker/Neo4j for now. FalkorDB Lite requires only Python and no external process — natural upgrade path without architecture change.
