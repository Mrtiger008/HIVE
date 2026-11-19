# NEXT_ACTIONS.md

## Phase 1 — DONE ✅
## Phase 2 — DONE ✅ (2026-11-19)
## Phase 3 — DONE ✅ (2026-11-19)

## Phase 4 — Session Capture (next)

Goal: Automatically capture useful knowledge from Claude Code sessions into HIVE.

Key tasks:
1. Research Claude Code hook capabilities (PostToolUse, Stop events)
2. Hook script: `hooks/session-capture.js` — write session events to `logs/sessions/`
3. Session metadata indexer: parse session logs, extract decisions/corrections/state changes
4. Memory extraction: auto-propose memories from session content (user confirms before storing)
5. `hive session import <log-path>` — manual import command
6. claude-mem ingestion: `hive ingest` reads claude-mem observations, converts to HIVE memories
7. Project state auto-update at session end
8. Tests: session capture, memory extraction, dedup against existing memories

## Upcoming decisions

- Semantic/vector search: transformers.js (~80MB pure JS) vs Python-based bridge — still deferred
- Entity extraction: auto-extract entities from memory content (Phase 5 candidate)

## Blocked on

Nothing. Phase 4 can start immediately.
