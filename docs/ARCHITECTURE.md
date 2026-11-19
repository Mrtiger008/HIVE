# docs/ARCHITECTURE.md — HIVE System Architecture

Date: 2026-11-19 | Phase: 0 (decided, not yet built)

---

## Design Principles

1. **Knowledge outlives the model** — the AI is replaceable, the knowledge is not
2. **Retrieval is as important as storage** — precision over volume
3. **Summaries don't replace source truth** — always keep the original
4. **Learning must be evidence-based** — user confirmation > AI inference
5. **Context contamination prevention** — project A must not bleed into project B
6. **Local-first** — no mandatory cloud, all data owned by the user

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    USER / AI ASSISTANT                   │
└──────────────────────┬──────────────────────────────────┘
                       │  `hive <command>`
┌──────────────────────▼──────────────────────────────────┐
│                   HIVE CLI (Node.js)                     │
│              src/hive.js — command dispatch              │
└──────┬──────────┬──────────┬──────────┬─────────────────┘
       │          │          │          │
  src/memory  src/projects  src/search  src/context
  (CRUD)      (CRUD)        (FTS5)      (router)
       │          │          │          │
┌──────▼──────────▼──────────▼──────────▼─────────────────┐
│                  src/db.js (SQLite layer)                 │
│              database/hive.db (single file)              │
└──────────────────────┬──────────────────────────────────┘
                       │  sync important memories
┌──────────────────────▼──────────────────────────────────┐
│              memory/ (Markdown files)                     │
│         Human-readable, git-versionable                   │
└─────────────────────────────────────────────────────────┘
```

---

## Storage Layer

### database/hive.db (SQLite)

The brain. All structured data, metadata, relationships, search indexes.

**Why SQLite**: Zero install, Windows-native, FTS5 built-in, single file (easy backup), supports 1 TB+ databases, `better-sqlite3` is the best Node.js binding.

#### Core Tables (Phase 1)

```sql
-- All memory types in one table, differentiated by memory_type
CREATE TABLE memories (
  id          TEXT PRIMARY KEY,       -- ulid or uuid
  title       TEXT NOT NULL,
  content     TEXT NOT NULL,
  memory_type TEXT NOT NULL,          -- core|domain|project|episodic|semantic|skill
  domain      TEXT,
  project_id  TEXT,
  created_at  INTEGER NOT NULL,       -- unix epoch ms
  updated_at  INTEGER NOT NULL,
  source      TEXT,
  source_type TEXT,                   -- conversation|document|code|api|observation
  source_ref  TEXT,
  confidence  REAL DEFAULT 0.5,       -- 0.0–1.0
  trust_level TEXT DEFAULT 'OBSERVED',-- see Trust System
  status      TEXT DEFAULT 'active',  -- active|archived|superseded|conflicted
  importance  INTEGER DEFAULT 5,      -- 1–10
  tags        TEXT,                   -- JSON array
  valid_from  INTEGER,
  valid_until INTEGER,
  supersedes  TEXT,                   -- memory id
  user_confirmed INTEGER DEFAULT 0,
  retrieval_keywords TEXT
);

CREATE TABLE projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  objective   TEXT,
  description TEXT,
  status      TEXT DEFAULT 'active',  -- active|paused|completed|archived
  domain      TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  tags        TEXT                    -- JSON array
);

CREATE TABLE entities (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  entity_type TEXT NOT NULL,          -- person|tool|org|concept|file|event
  description TEXT,
  created_at  INTEGER NOT NULL
);

CREATE TABLE relationships (
  id          TEXT PRIMARY KEY,
  from_id     TEXT NOT NULL,          -- entity or memory id
  rel_type    TEXT NOT NULL,          -- uses|created_from|supersedes|responsible_for|derived_from
  to_id       TEXT NOT NULL,          -- entity or memory id
  valid_from  INTEGER,
  valid_until INTEGER,
  confidence  REAL DEFAULT 0.5,
  created_at  INTEGER NOT NULL
);

CREATE TABLE sources (
  id          TEXT PRIMARY KEY,
  path        TEXT,                   -- local file path or URL
  source_type TEXT,
  hash        TEXT,                   -- sha256 for change detection
  description TEXT,
  created_at  INTEGER NOT NULL
);
```

#### FTS5 Search Index (Phase 1)

```sql
-- Full-text search over memories
CREATE VIRTUAL TABLE memories_fts USING fts5(
  id UNINDEXED,
  title,
  content,
  tags,
  retrieval_keywords,
  content='memories',
  content_rowid='rowid'
);
```

---

### memory/ (Markdown files)

Human-readable mirror. Important memories are written here as `.md` files.

**Why Markdown**: Readable without any application. Git-diffable. Exportable. Survives any AI service going down.

Directory structure mirrors memory types:
```
memory/
├── core/           # identity, preferences, working style
├── domains/
│   ├── data-analytics/
│   ├── software-engineering/
│   ├── professional-work/
│   └── ...
├── projects/
│   ├── <project-id>/
│   │   ├── PROJECT.md   # project record
│   │   ├── decisions/
│   │   └── episodes/
├── semantic/       # reusable facts, tool knowledge, definitions
├── episodic/       # significant events and sessions
├── skills/         # reusable procedures
├── entities/       # people, tools, orgs
├── decisions/      # standalone decision records
└── archive/        # superseded or outdated memories
```

**Sync policy**: Write to SQLite first (source of truth). Sync important memories to Markdown on `hive export` or on creation of high-importance memories (importance >= 7).

---

## Engine Layer (Node.js)

### src/db.js
SQLite connection. Schema init. Migrations (sequential, numbered).

### src/memory.js
Memory CRUD. Implements the full memory lifecycle:
`add → classify → validate → connect → store → retrieve → evaluate → consolidate`

### src/projects.js
Project CRUD. Project state tracking. Project isolation enforcement.

### src/search.js
FTS5 search with BM25 ranking. Filters: domain, project, trust level, recency, importance. Returns ranked results with provenance.

### src/context.js (Phase 2)
The context router. Given a task description:
1. Detect domain and project
2. Query memories, skills, entities
3. Rank by relevance + recency + confidence
4. Enforce context budget (configurable token count)
5. Detect ambiguity
6. Return context pack + provenance

### src/skills.js (Phase 6)
Skill library CRUD. Trigger-based retrieval. Promotion workflow.

### src/hive.js
CLI entry point. Command dispatch.

---

## Trust & Confidence System

Every memory has a `trust_level` and a `confidence` score.

| Trust Level | Meaning |
|-------------|---------|
| `USER_CONFIRMED` | User explicitly stated or confirmed |
| `SOURCE_VERIFIED` | Validated against a document/system/query |
| `OBSERVED` | Directly observed in a session |
| `INFERRED` | AI-derived from other facts |
| `AI_HYPOTHESIS` | Possibility needing validation |
| `CONFLICTED` | Multiple sources disagree |
| `OUTDATED` | Was valid, may no longer be current |
| `UNKNOWN` | Source or basis unclear |

**Rules**:
- Never promote `AI_HYPOTHESIS` to `USER_CONFIRMED` without explicit user input
- When facts conflict, preserve both with `CONFLICTED` status — resolve only with evidence
- `INFERRED` memories must cite the source memories they were derived from

---

## Context Router (Phase 2 design, built in Phase 2)

```
Task text
    │
    ▼
Step 1: Task understanding (keyword extraction, intent)
    │
    ▼
Step 2: Domain detection (which of my domains does this touch?)
    │
    ▼
Step 3: Project identification (which specific project?)
    │   If multiple projects match → surface ambiguity, don't guess
    ▼
Step 4: Memory retrieval
    │   - Project memory (strict isolation first)
    │   - Semantic memory (general knowledge)
    │   - Episodic (relevant past events)
    │   - Skills (by trigger matching, not just name)
    │   - Core memory (always available, low weight)
    ▼
Step 5: Rank by (relevance × confidence × recency × importance)
    │
    ▼
Step 6: Assemble context pack (within token budget)
    │
    ▼
Step 7: Confidence check — if low, ask clarifying question
    │
    ▼
Context pack (task + project state + memories + skills + sources + contradictions)
```

**Context contamination prevention**: Project A memories are only included when the task clearly relates to Project A. Cross-project knowledge requires an explicit, verifiable connection.

---

## Knowledge Graph (Phase 3 design)

**Phase 3**: SQLite `relationships` table with entity/memory links.

```
Entity: "Amazon Seller Central"  (entity_type: tool)
  ──uses──▶  Memory: "Session cookies expire after 30 days" (semantic)
  ──related_to──▶  Project: "Amazon Installation Report Sync"

Memory: "SQL query for double-counting bug" (episodic)
  ──created_from──▶  Skill: "SQL join validation"
  ──fixed──▶  Episode: "2026-10-18 Amazon query audit"
```

Traversal: BFS/DFS in SQL using recursive CTEs or multiple joins. Simple but sufficient for Phase 3.

**Upgrade path**: If traversal becomes slow or graph algorithms (shortest path, clustering) are needed, migrate to FalkorDB Lite (embedded, `pip install falkordb`, Python 3.12+). Same data model, no server process.

---

## Session Continuity

HIVE is designed to survive any conversation ending or compacting.

**What survives a session loss**:
- Everything in `database/hive.db`
- Everything in `memory/` Markdown files
- Everything committed to Git
- Project state in `PROJECT_STATE.md`

**What doesn't survive**:
- Uncommitted in-memory state during active development

**Session start protocol** (in CLAUDE.md): Read PROJECT_STATE.md → NEXT_ACTIONS.md → ROADMAP.md → git status → resume.

---

## Upgrade Paths

| Component | Phase 1 | Phase 2+ upgrade |
|-----------|---------|-----------------|
| Full-text search | SQLite FTS5 | — (FTS5 scales well) |
| Semantic search | None | transformers.js (JS) or SQLite-vec |
| Graph | SQLite relationships table | FalkorDB Lite (embedded Python) |
| Knowledge ingestion | Manual CLI | cognee pipeline (optional) |
| Session capture | Manual checkpoint | Claude Code hooks + MCP |

---

## What HIVE Is NOT

- Not a replacement for claude-mem (which is an observation capture system)
- Not a vector database vendor product
- Not a cloud service
- Not a chatbot
- Not a UI-first system

HIVE is an infrastructure layer. The UI (Phase 7+) sits on top of it.
