# docs/TECH_STACK.md — Technology Stack

Date: 2026-11-19

---

## Phase 1 Stack (what we're building on)

| Component | Technology | Reason |
|-----------|-----------|--------|
| Primary storage | SQLite 3.53.4 | Already installed, FTS5 built-in, single file, Windows-native |
| SQLite Node.js binding | better-sqlite3 | Synchronous API, fastest binding, Windows prebuilt binaries |
| Full-text search | SQLite FTS5 | Built into SQLite, BM25 ranking, no install |
| Human-readable layer | Markdown files | No app required, git-diffable, exportable |
| Versioning | Git 2.55.0 | Already installed, proven |
| Engine language | Node.js 24.17.0 | Already installed, best SQLite binding, Claude Code alignment |
| Package manager | npm 11.13.0 | Already installed |

**Total new installs for Phase 1**: 1 npm package (`better-sqlite3`)

---

## Phase 2 Additions (semantic search)

| Component | Candidate | Decision |
|-----------|-----------|---------|
| Local embeddings | transformers.js | Pure JS, ONNX models, offline, ~80–400MB model download |
| Alternative | sqlite-vec + Python bridge | If transformers.js model quality insufficient |
| Decision | Defer to Phase 2 | FTS5 is enough for Phase 1 |

---

## Phase 3 Additions (graph)

| Component | Technology | Decision |
|-----------|-----------|---------|
| Graph (Phase 3 start) | SQLite relationships table | Zero install, recursive CTE traversal |
| Graph (upgrade path) | FalkorDB Lite | `python -m pip install falkordb`, embedded, Python 3.12+, no server |

---

## Deferred / Rejected

| Technology | Status | Reason |
|-----------|--------|--------|
| PostgreSQL | Rejected | Server process, overkill for local use |
| Neo4j | Deferred | External server, complex Windows setup |
| Docker | Avoided | Not required by chosen stack |
| MongoDB | Rejected | JSON-only, no FTS, no graph |
| ChromaDB | Deferred | Python-based, good vector DB, consider Phase 2 |
| cognee | Deferred | High complexity, 755 open issues, Python setup friction |
| graphiti | Deferred | Requires external graph DB |
| graphiti-mem | Rejected | 1 star, 7 commits, requires 2 external APIs |
| cogni-code | Rejected | 3 stars, no semantic search |
| Redis | Rejected | External process, not needed |
| Elasticsearch | Rejected | Heavy, overkill |

---

## Python Usage Policy

Python 3.13.14 is available via `python` or `py`. pip is at `python -m pip` (not on PATH directly).

**Phase 1**: Python not used (pure Node.js)  
**Phase 2**: Python used for embeddings if transformers.js is insufficient. Install via `python -m pip install <package>`.  
**Phase 3**: Python used for FalkorDB Lite if graph upgrade is needed.

Python scripts live in `scripts/` directory. Never mix Python and Node.js in `src/`.

---

## Security-Relevant Technology Choices

- **No ORM**: Raw SQL with parameterized queries prevents SQL injection
- **better-sqlite3**: Synchronous, no async callback confusion
- **Local SQLite**: No network exposure
- **Git-tracked Markdown**: Human-auditable history of knowledge changes

---

## Dependency Policy

- Keep `node_modules` minimal — each new dependency requires a reason
- Prefer Node.js built-ins and SQLite over npm packages
- Never install a package just because it's "commonly used"
- Document every dependency in `package.json` with a comment in this file

## Current dependencies (Phase 1)

| Package | Version | Purpose |
|---------|---------|---------|
| better-sqlite3 | latest stable | SQLite access from Node.js |

(This table must be updated whenever a package is added or removed.)
