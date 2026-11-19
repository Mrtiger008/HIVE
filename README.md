# HIVE

Personal AI Knowledge, Memory & Learning System.

HIVE is a persistent, evolving knowledge layer for AI assistants.
The AI model is replaceable. The knowledge is permanent.

## Status

Phase 0 — Research & Architecture COMPLETE  
Phase 1 — Core Foundation (next)

## Quick Start (Phase 1+)

```
node src/hive.js --help
```

## Documentation

- `docs/ARCHITECTURE.md` — system design
- `docs/RESEARCH.md` — technology research and comparisons
- `docs/TECH_STACK.md` — technology choices and rationale
- `docs/SECURITY.md` — security requirements and implementation
- `ROADMAP.md` — development phases and milestones
- `PROJECT_STATE.md` — current state (read this each session)

## Core Design

- **Storage**: SQLite (`database/hive.db`) + Markdown files (`memory/`)
- **Search**: SQLite FTS5 (full-text), semantic search (Phase 2)
- **Graph**: SQLite relationships table, upgrade to FalkorDB Lite (Phase 3)
- **CLI**: Node.js, no mandatory external services
- **Local-first**: all knowledge owned by you, exportable at any time

## Memory Types

| Type | Location |
|------|----------|
| Core/Identity | `memory/core/` |
| Domain | `memory/domains/<domain>/` |
| Project | `memory/projects/<id>/` |
| Episodic | `memory/episodic/` |
| Semantic | `memory/semantic/` |
| Skills | `memory/skills/` |
| Entities | `memory/entities/` |
| Decisions | `memory/decisions/` |
| Archive | `memory/archive/` |

## Privacy

No cloud services required. No knowledge leaves your machine without your approval.
Never store credentials in memory files.
