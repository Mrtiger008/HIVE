# NEXT_ACTIONS.md

## Phase 1 — DONE ✅
## Phase 2 — DONE ✅ (2026-11-19)
## Phase 3 — DONE ✅ (2026-11-19)

## Phase 4 — DONE ✅ (2026-11-19)

## Phase 5 — Learning System (next)

Goal: Make HIVE learn from patterns — reinforce important memories, decay stale ones, detect recurring topics, offer proactive suggestions.

Key tasks:
1. `src/decay.js` — recency decay score: `importance × (1 / (1 + days_since_access / 30))`. Scheduled sweep marks OUTDATED memories not accessed in 90d.
2. `src/reinforce.js` — bump importance (+1, max 10) each time a memory is retrieved via search. Keeps high-utility memories surfaced.
3. `src/patterns.js` — sliding-window keyword frequency over last 30d of memories. Returns top recurring topics.
4. `hive suggest [--project <id>]` — surfaces 5 memories due for reinforcement or review (high decay, low importance, long ago accessed).
5. `hive patterns` — lists top recurring topics/entities across recent memories.
6. Tests: 10 cases covering decay math, reinforcement capping, pattern extraction, suggest ranking.

## Upcoming decisions

- Semantic/vector search: transformers.js (~80MB pure JS) vs Python-based bridge — still deferred to Phase 6
- Auto-entity extraction from memory content: candidate for Phase 5 or 6

## Blocked on

Nothing. Phase 5 can start immediately.
