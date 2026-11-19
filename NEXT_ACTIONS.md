# NEXT_ACTIONS.md

## Phase 1 — DONE ✅
## Phase 2 — DONE ✅ (2026-11-19)
## Phase 3 — DONE ✅ (2026-11-19)

## Phase 4 — DONE ✅ (2026-11-19)
## Phase 5 — DONE ✅ (2026-11-19)

## Phase 6 — Semantic Search (next)

Goal: Add vector/semantic search so HIVE can find memories by meaning, not just keywords.

Key tasks:
1. Decide embedding approach: **transformers.js** (pure JS, ~80MB, `Xenova/all-MiniLM-L6-v2`) vs Python bridge (`sentence-transformers`). transformers.js is simpler (no Python subprocess); Python bridge is faster on CPU.
2. `src/embeddings.js` — generate 384-dim embedding for a text string. Cache in `database/embeddings/` keyed by content hash to avoid re-computing.
3. Schema v3 migration: add `embedding BLOB` column to memories; backfill on first run.
4. `src/semantic.js` — cosine similarity search: embed query, compare against all stored embeddings, return top-N by similarity. Hybrid mode: combine FTS5 BM25 score with cosine similarity.
5. `hive semantic "<query>" [--limit N] [--hybrid]` — CLI command.
6. `hive embed backfill` — recompute embeddings for all memories missing one.
7. Tests: 10 cases covering embedding generation, cosine similarity math, semantic search returning semantically related results.

## Upcoming decisions

- Embedding model: MiniLM-L6-v2 (fast, 384 dims) vs MPNet (better quality, 768 dims)
- Auto-entity extraction from memory content: Phase 7 candidate

## Blocked on

Decision: transformers.js vs Python bridge. transformers.js is recommended — no Python subprocess, same Node.js process, works without extra install.
