# NEXT_ACTIONS.md

## Phase 1 — DONE ✅
## Phase 2 — DONE ✅ (2026-11-19)
## Phase 3 — DONE ✅ (2026-11-19)

## Phase 4 — DONE ✅ (2026-11-19)
## Phase 5 — DONE ✅ (2026-11-19)

## Phase 6 — DONE ✅ (2026-11-19)

## Phase 7 — Smart Briefings — DONE ✅ (2026-11-19)

## Phase 8 — Entity Extraction / Auto-tagging (candidate)

Goal: Automatically extract entities (people, tools, concepts) from memory content on add/update and create graph links without manual `hive entity link` calls.

Options:
- Simple regex patterns for common entity types (email → person, URL → tool, `npm install X` → tool)
- Keyword matching against existing entity names/aliases
- Deferred: LLM-based extraction (adds latency/cost)

## Upcoming decisions

- Phase 8 scope: auto-extraction vs manual only (current)
- UI: web dashboard for browsing memories and graph (Phase 9+ candidate)
- Export: RSS/Atom feed of important memories for external consumption
