# HIVE — Project Instructions for Claude Code

HIVE is a long-running project. Every session must start by reading project state.
Every substantial session must end by updating project state.

## Session Start (mandatory)

1. Read `PROJECT_STATE.md` — current architecture, phase, what's built
2. Read `NEXT_ACTIONS.md` — highest-priority task
3. Read `ROADMAP.md` — phase context
4. Read last 10 entries in `CHANGELOG.md`
5. Run `git status` — understand working tree state
6. Run relevant tests if the last session left work unfinished
7. Identify the first task from NEXT_ACTIONS.md and begin

Do not ask "where were we?" — the files above answer that.
Do not trust a session summary over the actual code.

## Session End (mandatory after substantial work)

1. Update `PROJECT_STATE.md` — current architecture, what changed
2. Update `NEXT_ACTIONS.md` — what to do next session
3. Update `ROADMAP.md` — mark completed tasks
4. Append to `CHANGELOG.md`
5. Record decisions in `DECISIONS.md`
6. Run tests, record results
7. Check for secrets before committing
8. Commit stable work: `git add -p` then commit

## Autonomy Policy

Act independently on: research, reading docs, writing code, running tests,
creating files, making git commits (after secret check).

Ask before: installing system-wide software, deleting data, uploading anything,
connecting to external accounts, making irreversible changes.

## Key Architecture (brief — full detail in docs/ARCHITECTURE.md)

Storage: SQLite (`database/hive.db`) + Markdown files (`memory/`)
Engine: Node.js (`src/`)
Search: SQLite FTS5 (Phase 1), semantic/vector (Phase 2)
Graph: SQLite relationships table (Phase 3), FalkorDB Lite upgrade path
CLI: `node src/hive.js <command>`

claude-mem (the session observation system already installed) is a FEEDER to HIVE,
not the HIVE core. HIVE is the structured knowledge base.

## Never

- Store credentials, tokens, API keys, or passwords in `memory/` or `database/`
- Silently destroy stored memories during refactoring
- Treat AI-generated inferences as confirmed facts
- Run destructive commands without backup
