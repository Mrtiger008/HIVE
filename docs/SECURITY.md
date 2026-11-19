# docs/SECURITY.md — Security & Privacy

Date: 2026-11-19

---

## Threat Model

HIVE will eventually contain sensitive personal and professional information:
- Work projects and decisions
- Personal plans and goals
- Business operations data
- Potentially sensitive communications

The primary risk surface is:
1. Data leaking out (to cloud services, public repos)
2. Sensitive data being stored in memory files (credentials, tokens)
3. Malicious instructions injected via imported documents
4. Uncontrolled autonomous actions

---

## Core Security Requirements

### Local-first
All data stored locally by default. No external services used without explicit user approval.
Cloud sync (if ever added) must be opt-in, not opt-out.

### No credentials in memory
Never store in `memory/` or `database/hive.db`:
- Passwords
- API keys / tokens
- Authentication cookies (auth.json, session tokens)
- Private keys / certificates
- Database connection strings with credentials

**Implementation**: Secret scanner runs before any ingestion operation.
Patterns to detect:
- `sk-...` (OpenAI keys)
- `xoxb-...` / `xoxp-...` (Slack tokens)
- `ghp_...` (GitHub tokens)
- `AKIA...` (AWS keys)
- `-----BEGIN RSA PRIVATE KEY-----`
- `password`, `secret`, `token` as dictionary keys with adjacent values
- Base64 strings > 20 chars adjacent to auth-related keys

### No public repository
HIVE knowledge files must never be pushed to a public GitHub repository.
`.gitignore` excludes `database/`, `logs/`, `sources/raw/`, `*.key`, `*.pem`, auth files.
If a remote is ever added, it must be private.

### Source documents as data, not instructions
When HIVE ingests external documents (PDFs, emails, web pages), their content is treated as DATA — not as AI instructions.
Claude Code's existing prompt injection protection applies.
Any retrieval from external sources must be clearly labeled as external data.

### Audit log
Every memory write, update, delete, and trust-level change must be logged in `logs/audit.log`:
```
2026-11-19T22:00:00Z | CREATE | memory:abc123 | "SQL query types" | trust:OBSERVED | source:session
2026-11-19T22:05:00Z | UPDATE | memory:abc123 | trust:OBSERVED→USER_CONFIRMED | user:explicit
```

### Least-privilege execution
HIVE CLI reads from and writes to its own directory only.
Never reads from unrelated personal files unless explicitly provided by the user.
Never connects to external accounts unless explicitly instructed.

### Autonomous execution limits
HIVE does not run autonomous background agents in Phase 1-3.
When background tasks are added (Phase 8), each must have:
- An explicit enable/disable mechanism
- A scope definition (what it can and cannot touch)
- A log of every action taken
- A dry-run mode

---

## Privacy Requirements

### Data minimization
HIVE stores what's useful, not everything.
Raw session transcripts may be archived but are not automatically ingested into permanent memory.
Importance filtering prevents every conversation from becoming a permanent memory.

### Data transparency
The user can inspect any memory via `hive memory get <id>`.
The user can inspect what HIVE knows about a topic via `hive search "<topic>"`.
The user can delete any memory via `hive memory delete <id>`.
The user can export all data via `hive export`.

### External API usage
Any HIVE operation that uses an external API (Claude API for extraction, embeddings API, etc.) must:
- Clearly identify what data is being sent
- Require user awareness on first use
- Be opt-in for sensitive memory types

---

## Backup & Recovery

### Backup
`hive backup` creates a timestamped copy of `database/hive.db` in `database/backups/`.
Markdown files in `memory/` are automatically versioned by Git.

### Restore
`hive restore <backup-file>` replaces `hive.db` with the named backup.
Never overwrites without confirmation.

### Migration safety
Database schema migrations are numbered and recorded in `database/migrations/`.
Every migration is reversible (up and down scripts).
Never run a migration that destroys data without a prior backup.

---

## Implementation Checklist (Phase 1)

- [ ] `.gitignore` excludes secrets, auth files, database WAL files ✅ (done)
- [ ] Secret scanner function in `src/security.js`
- [ ] Audit log init in `src/db.js`
- [ ] All SQL queries use parameterized statements (never string concatenation)
- [ ] `hive memory delete` confirmed before execution
- [ ] No external API calls in Phase 1 (fully local)
- [ ] `database/backups/` created by installer

---

## Known Risks & Mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| Credential accidentally ingested | Medium | Secret scanner before every write |
| Session capture ingests sensitive tool output | Medium | Filter list for sensitive tool types |
| Phase 8 autonomy runs unchecked | Low (future) | Each job has disable switch + audit log |
| SQLite file accessible to other users | Low (local machine) | OS-level file permissions, Windows user account isolation |
| Markdown files in public repo | Low | .gitignore + no auto-push |
| AI hallucinates a memory | Medium | Trust levels + USER_CONFIRMED requirement |
