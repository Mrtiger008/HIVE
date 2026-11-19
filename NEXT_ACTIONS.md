# NEXT_ACTIONS.md

## Immediate next session — Phase 1 start

### Decision needed from user before starting:
1. **Approve Phase 1 start** — building the SQLite schema and Node.js CLI
2. **package.json dependencies** — only `better-sqlite3` needed for Phase 1 (all else built-in).
   Confirm approval to `npm install better-sqlite3`.

### Once approved, in this order:

1. `npm init` in HIVE root, install `better-sqlite3`
2. `src/db.js` — SQLite init, schema creation, migrations
3. SQLite schema: `memories`, `projects`, `entities`, `sources`, `relationships` tables + FTS5
4. `src/memory.js` — memory CRUD with trust levels
5. `src/projects.js` — project CRUD
6. `src/hive.js` — CLI entry point, command dispatch
7. First working commands: `hive memory add`, `hive search`, `hive project create`
8. `tests/` — baseline test suite (10 tests from spec)
9. `hive backup` / `hive export`
10. First git commit of working code

## Blocked on

Nothing currently blocked. Architecture decided. Waiting for session-start approval.

## Upcoming decisions (not blocking Phase 1)

- Semantic search approach for Phase 2: transformers.js (pure JS, ~80MB model) vs Python bridge
- Whether to ingest existing claude-mem observations into HIVE as a backfill
