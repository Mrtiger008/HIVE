# NEXT_ACTIONS.md

## Phase 1 — DONE ✅
## Phase 2 — DONE ✅ (2026-11-19)

## Phase 3 — Knowledge Graph (next)

Goal: Entities, relationships, and provenance graph over memories.

Key tasks:
1. `src/entities.js` — CRUD for the `entities` table (name, type, attributes)
2. `src/relationships.js` — CRUD for `relationships` table (subject, predicate, object)
3. Entity extraction from memory content (simple rule-based, no LLM required for MVP)
4. Graph traversal: given an entity, fetch related memories and connected entities
5. `hive entity list/get`, `hive relationship list` CLI commands
6. Tests: entity creation, relationship traversal, entity extraction

## Upcoming decisions

- Semantic/vector search: transformers.js (~80MB pure JS) or Python-based — still deferred
- Whether to backfill claude-mem observations into HIVE (Phase 4 integration)
- Entity extraction: rule-based regex patterns vs NLP library vs LLM-assisted

## Blocked on

Nothing. Phase 3 can start immediately.
