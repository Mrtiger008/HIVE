# docs/RESEARCH.md — Phase 0 Research Findings

Date: 2026-11-19

---

## 1. Environment Audit

| Component | Version | Notes |
|-----------|---------|-------|
| OS | Windows 10 Pro 10.0.19045 | Build 19045 |
| PowerShell | 5.1 | Not PS7 — avoid PS7-only syntax |
| Git | 2.55.0 | ✅ Available |
| Node.js | 24.17.0 | ✅ Excellent for CLI |
| npm | 11.13.0 | ✅ |
| Python | 3.13.14 | ✅ Available |
| pip | 26.1.2 | ⚠️ Available via `python -m pip` only, not on PATH directly |
| Claude Code | 2.1.296 | ✅ Hooks, MCP, skills available |
| SQLite | 3.53.4 (32-bit) | ✅ Available system-wide |
| Free disk (C:) | 331.3 GB | ✅ Abundant |

**Notable**: pip is accessible as `python -m pip` but not as a bare `pip` command. All Python-based tooling must use `python -m pip install` or the `py` launcher. This is a known Python Windows installer quirk.

**claude-mem status**: Already installed and running as an MCP server (`mcp__plugin_claude-mem_mcp-search__*`). Version matches Claude Code 2.1.296 integration. Provides observation capture and session context injection.

---

## 2. Candidate Repository Evaluations

### thedotmack/claude-mem ⭐ 118,400 stars

- **Maintained**: Extremely active — 4,824 commits, updated hours before audit
- **License**: Apache-2.0
- **Language**: TypeScript (Bun runtime)
- **Windows**: Explicitly supported — Windows installer places `claude-mem.exe` at `%LOCALAPPDATA%\claude-mem\bin\`
- **Storage**: SQLite FTS5 (full-text) + ChromaDB (semantic/vector)
- **What it does**: Session observation system — captures tool calls, compresses to observations via a secondary LLM call, injects relevant context at session start. Works with Claude Code, Codex, Cursor, OpenCode.
- **Dependencies**: Node.js 20.19+, Bun (auto-installed), Python/uv (auto-installed for ChromaDB)
- **Red flags**:
  - Observer model uses a freemium subscription (30-day trial, then paid tier or falls back to your Anthropic plan)
  - Telemetry on by default (`npx claude-mem telemetry disable` to opt out)
  - README mentions a "CMEM" cryptocurrency community token — unusual for a dev tool
  - Cloud sync is opt-in (not mandatory)
- **HIVE verdict**: **Already installed** — use as a session observation feeder into HIVE. Not a foundation to build HIVE on. Its role is observation capture, not structured knowledge management.

---

### topoteretes/cognee ⭐ 33,400 stars

- **Maintained**: Very active — v1.6.1 released September 2026, 12,861 commits
- **License**: Apache-2.0
- **Language**: Python 3.10–3.14
- **Windows**: Not explicitly confirmed but no known blockers
- **Storage**: Graph + vector, optionally Postgres as unified store
- **What it does**: Full knowledge graph + vector memory platform. Primitives: `remember`, `recall`, `improve`, `forget`. Fully local with GLiNER (CPU NLP, no API key needed). MCP server included.
- **Dependencies**: Python 3.10+, GLiNER (downloads on first use), `dlt` (required as of v1.6.1)
- **Red flags**: 755 open issues, 356 open PRs (high churn). Postgres graph store is labeled "demo". Commercial Cognee Cloud exists.
- **HIVE verdict**: **Deferred** — most capable for a full Python-based pipeline, but too complex for Phase 1. Revisit if SQLite hits limits in Phase 2-3. GLiNER is interesting for local NLP without API keys.

---

### getzep/graphiti ⭐ 32,900 stars

- **Maintained**: Active — 1,068 commits, CI passing
- **License**: Apache-2.0 (+ Zep-CLA for contributors)
- **Language**: Python
- **Windows**: Not confirmed. FalkorDB can run via Docker or FalkorDB Lite (embedded, Python 3.12+).
- **What it does**: Temporal knowledge graph — tracks facts with bi-temporal validity windows, auto-invalidates contradicted facts, hybrid retrieval (semantic + BM25 + graph). Episodes are the provenance unit.
- **Dependencies**: Python 3.10+, one of: Neo4j 5.26, FalkorDB 1.1.2, or Amazon Neptune. LLM API key required.
- **Red flags**: Mandatory external graph DB (Neo4j Desktop or FalkorDB Docker) is the main friction. No zero-install embedded path except FalkorDB Lite (Python 3.12+).
- **HIVE verdict**: **Deferred** — powerful temporal graph model, but external DB requirement is friction for Phase 1. The bi-temporal model is conceptually ideal for HIVE's "valid-from / valid-until" memory requirements. Revisit in Phase 3 with FalkorDB Lite.

---

### oliverhees/graphiti-mem ⭐ 1 star

- **Maintained**: Brand new — 7 commits, no releases
- **License**: MIT (claimed in README, no LICENSE file in repo)
- **Language**: JavaScript + Python (mixed)
- **Windows**: Unknown, curl install script is Windows-hostile
- **What it does**: Claude Code plugin wrapping Graphiti + Kuzu (embedded graph, no external server). Hooks capture tool output as episodes.
- **Dependencies**: Node.js 18+, Anthropic API, Voyage AI API (embeddings — requires separate account)
- **Red flags**: 1 star, 0 forks, 7 commits. Two mandatory external APIs. No LICENSE file. No community validation.
- **HIVE verdict**: **Skip** — too early-stage and unproven. Kuzu embedded approach is architecturally interesting. Revisit if it reaches 500+ stars.

---

### ConnorCallahan01/cogni-code ⭐ 3 stars

- **Maintained**: Modest — 230 commits, 8 open PRs, single contributor
- **License**: MIT
- **Language**: TypeScript (npm)
- **Windows**: Not confirmed but npm-based, likely compatible
- **What it does**: Plain Markdown files at `~/.graph-memory/`. Layered model: cognitive profile (~400 tokens, always loaded), project lens (~300 tokens), session logs, knowledge graph (Markdown YAML). Background pipeline: scribe → auditor → librarian → dreamer → observer → Skillforge.
- **Dependencies**: npm/Node.js, Anthropic API key, Docker (optional for daemon)
- **Red flags**: 3 stars, 8 open PRs with single contributor. No semantic/vector search. Pipeline complexity (6 stages) is high for adoption level.
- **HIVE verdict**: **Skip** — interesting plain-file design but no semantic search, no community validation.

---

## 3. Technology Research

### SQLite FTS5

Built into SQLite 3.x. Full-text search with BM25 ranking, prefix search, phrase search. No install required. Handles millions of rows on consumer hardware. Limitation: no semantic/vector search (plain FTS5 only).

Verdict: **Use in Phase 1** as the primary search mechanism.

### better-sqlite3 (npm)

The best Node.js SQLite binding — synchronous API, faster than the async alternatives, actively maintained. No native compilation issues on Windows with prebuilt binaries.

Verdict: **Use in Phase 1**.

### SQLite-vec / sqlite-vss

SQLite extensions for vector search. sqlite-vec is the more actively maintained one. Requires a prebuilt `.dll` on Windows. Not in SQLite core.

Verdict: **Evaluate in Phase 2** after core FTS5 search is working.

### transformers.js

Pure JavaScript ML — runs ONNX models in Node.js. Can do embeddings with no Python. Models are ~80–400MB. Works offline.

Verdict: **Primary candidate for Phase 2 semantic search** — avoids Python for the embedding pipeline.

### FalkorDB Lite

Embedded graph database for Python 3.12+. No server process, no Docker. Installs as `pip install falkordb`. FalkorDB-compatible query language.

Verdict: **Phase 3 upgrade path** if SQLite `relationships` table becomes limiting.

---

## 4. Claude Code Integration Research

**Available hooks** (Claude Code 2.1.296):
- `PreToolUse` — fires before each tool call
- `PostToolUse` — fires after each tool call (output available)
- `Notification` — fires on notifications
- `Stop` — fires when the agent stops

**claude-mem integration**: claude-mem is already using these hooks to capture observations. HIVE's Phase 4 integration should use `Stop` / session-end hooks to capture project state and extract memories from the session.

**MCP**: Claude Code supports MCP servers. HIVE can eventually expose a local MCP server (`hive-mcp`) that Claude Code loads context from at session start.

---

## 5. Conclusions

1. No existing off-the-shelf system meets HIVE's full requirements without significant complexity or cloud dependency.
2. SQLite + Node.js + Markdown is the right foundation for Phase 1 — zero new installs, fully local, fully owned.
3. claude-mem is already in place as the session capture layer — HIVE is the structured knowledge base it feeds into.
4. Python + pip are available for Phase 2 ML/embeddings work (via `python -m pip`).
5. The upgrade path to cognee, graphiti, or FalkorDB is clear if Phase 1-3 hit limits.
