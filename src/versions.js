'use strict';
const { getDb } = require('./db');

function snapshot(memoryId, title, content) {
  getDb().prepare(
    'INSERT INTO memory_versions (memory_id, title, content, snapshot_at) VALUES (?,?,?,?)'
  ).run(memoryId, title, content, Date.now());
}

function list(memoryId) {
  return getDb().prepare(
    'SELECT id, memory_id, title, snapshot_at FROM memory_versions WHERE memory_id=? ORDER BY snapshot_at DESC'
  ).all(memoryId);
}

function get(versionId) {
  return getDb().prepare('SELECT * FROM memory_versions WHERE id=?').get(versionId);
}

// Returns line-level diff as array of {type:'add'|'del'|'eq', text} objects
function diff(textA, textB) {
  const linesA = textA.split('\n');
  const linesB = textB.split('\n');
  const result = [];
  // LCS-based diff (simple Myers-lite: good enough for short memory content)
  const m = linesA.length, n = linesB.length;
  // dp[i][j] = length of LCS of linesA[0..i-1] and linesB[0..j-1]
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = linesA[i-1] === linesB[j-1] ? dp[i-1][j-1] + 1 : Math.max(dp[i-1][j], dp[i][j-1]);
  // Traceback
  const ops = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && linesA[i-1] === linesB[j-1]) { ops.push({ type: 'eq', text: linesA[i-1] }); i--; j--; }
    else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) { ops.push({ type: 'add', text: linesB[j-1] }); j--; }
    else { ops.push({ type: 'del', text: linesA[i-1] }); i--; }
  }
  return ops.reverse();
}

module.exports = { snapshot, list, get, diff };
