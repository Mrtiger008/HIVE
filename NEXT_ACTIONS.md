# NEXT_ACTIONS.md

## Phase 1 — DONE ✅
## Phase 2 — DONE ✅ (2026-11-19)
## Phase 3 — DONE ✅ (2026-11-19)

## Phase 4 — DONE ✅ (2026-11-19)
## Phase 5 — DONE ✅ (2026-11-19)

## Phase 6 — DONE ✅ (2026-11-19)

## Phase 7 — Smart Briefings (next)

Goal: Generate a focused "daily briefing" context pack when a session starts — surfaces the most relevant memories for what the user is about to work on, plus stale memories needing review.

Key tasks:
1. `src/briefing.js` — `generateBriefing(task, { projectId, budget })`:
   - Calls `buildContext(task)` (Phase 2 context router) for top memories by BM25
   - Calls `semantic.search(task)` for top memories by cosine similarity
   - Merges results (deduplicated by id), re-ranks by combined BM25 + semantic + decay score
   - Adds "needs review" section: `stalest()` top 3 that haven't been touched in 14+ days
   - Returns a formatted markdown briefing under `budget` tokens
2. `hive brief "<what I'm working on today>" [--project <id>] [--budget 1500]` — print the briefing to stdout
3. `hive brief --daily` — no task description; uses patterns.topKeywords() to infer topic from recent 7-day activity
4. Auto-briefing hook: add to `hooks/session-capture.js` — run `brief --daily` on session stop so the NEXT session gets yesterday's context
5. Tests: 10 cases covering briefing generation, dedup between keyword and semantic results, budget enforcement, staleness surfacing

## Upcoming decisions

- Auto-briefing output format: Markdown vs structured JSON for programmatic ingestion
- Entity extraction from memory content: Phase 8 candidate

## Blocked on

Nothing. Phase 7 can start immediately.
