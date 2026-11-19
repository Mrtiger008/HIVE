#!/usr/bin/env node
'use strict';
// Auto-capture hook — run on Claude Code Stop event.
// Finds the current session's JSONL, extracts proposals, stores them into HIVE.
//
// Wire in .claude/settings.json:
//   "hooks": {
//     "Stop": [{ "hooks": [{ "type": "command",
//       "command": "node \"C:/Users/Akhilesh Kumar Tiwar/HIVE/hooks/session-capture.js\"" }] }] }
//
// Env vars available from Claude Code hook runtime:
//   CLAUDE_SESSION_ID       — session UUID
//   CLAUDE_PROJECT_DIR      — absolute path of the project directory

const path  = require('path');
const fs    = require('fs');
const os    = require('os');

const sessionId  = process.env.CLAUDE_SESSION_ID;
const projectDir = process.env.CLAUDE_PROJECT_DIR;

if (!sessionId) {
  process.stderr.write('[hive:session-capture] CLAUDE_SESSION_ID not set — skipping\n');
  process.exit(0);
}

// Derive the JSONL path from the project dir
const claudeDir = path.join(os.homedir(), '.claude', 'projects');
let encoded;
if (projectDir) {
  // Encode: replace \ and / with -, drop drive colon
  encoded = projectDir.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1:').replace(/[:/]/g, '-');
} else {
  // Fallback: scan for the session file
  try {
    const all = fs.readdirSync(claudeDir);
    for (const dir of all) {
      const candidate = path.join(claudeDir, dir, `${sessionId}.jsonl`);
      if (fs.existsSync(candidate)) { encoded = dir; break; }
    }
  } catch {}
}

if (!encoded) {
  process.stderr.write('[hive:session-capture] Could not locate session JSONL — skipping\n');
  process.exit(0);
}

const jsonlPath = path.join(claudeDir, encoded, `${sessionId}.jsonl`);
if (!fs.existsSync(jsonlPath)) {
  process.stderr.write(`[hive:session-capture] JSONL not found at ${jsonlPath} — skipping\n`);
  process.exit(0);
}

// Set HIVE_DB to the project's hive.db if we know the project dir
if (projectDir) {
  const hiveDb = path.join(projectDir, 'database', 'hive.db');
  if (fs.existsSync(hiveDb)) process.env.HIVE_DB = hiveDb;
}

const { fromSession } = require(path.join(__dirname, '..', 'src', 'ingest'));

try {
  const { stored } = fromSession(jsonlPath, { auto: true, maxProposals: 10 });
  if (stored.length > 0) {
    process.stdout.write(`[hive:session-capture] Stored ${stored.length} memories from session ${sessionId.slice(0,8)}\n`);
  }
} catch (err) {
  process.stderr.write(`[hive:session-capture] Error: ${err.message}\n`);
}
