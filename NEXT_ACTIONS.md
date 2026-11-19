# NEXT_ACTIONS.md

## Phase 1 — DONE ✅
## Phase 2 — DONE ✅ (2026-11-19)
## Phase 3 — DONE ✅ (2026-11-19)

## Phase 4 — DONE ✅ (2026-11-19)
## Phase 5 — DONE ✅ (2026-11-19)

## Phase 6 — DONE ✅ (2026-11-19)

## Phase 7 — Smart Briefings — DONE ✅ (2026-11-19)

## Phase 8 — Entity Extraction / Auto-tagging — DONE ✅ (2026-11-20)

## Phase 9 — Web Dashboard (candidate)

Goal: Browser-based UI to explore memories, the knowledge graph, briefings, and patterns — no CLI required for daily use.

Candidate features:
- `/memories` — searchable list with filters (type, project, trust)
- `/graph` — entity relationship visualization (D3 or plain SVG)
- `/brief` — load and display last-briefing.md
- `/patterns` — top keywords chart

Implementation: single `server.js` (Node.js http) + vanilla JS frontend, no framework. Served from `src/server.js` on a local port.

## Upcoming decisions

- Phase 9 scope: read-only dashboard vs full CRUD in browser
- Phase 10: REST API layer for external integrations (Obsidian plugin, Alfred, etc.)
