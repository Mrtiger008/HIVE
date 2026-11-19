'use strict';
const { getDb } = require('./db');

// Minimal line diff: returns [{type:'eq'|'add'|'del', text}]
function lineDiff(a, b) {
  const aLines = (a || '').split('\n');
  const bLines = (b || '').split('\n');
  const result = [];
  // LCS-based diff (patience-lite: good enough for memory content sizes)
  const m = aLines.length, n = bLines.length;
  // dp[i][j] = length of LCS of aLines[0..i-1] and bLines[0..j-1]
  const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = aLines[i-1] === bLines[j-1]
        ? dp[i-1][j-1] + 1
        : Math.max(dp[i-1][j], dp[i][j-1]);
  // Backtrack
  const ops = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && aLines[i-1] === bLines[j-1]) {
      ops.push({ type: 'eq',  text: aLines[i-1] }); i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) {
      ops.push({ type: 'add', text: bLines[j-1] }); j--;
    } else {
      ops.push({ type: 'del', text: aLines[i-1] }); i--;
    }
  }
  return ops.reverse();
}

const COMPARE_FIELDS = ['title','memory_type','domain','confidence','importance',
                        'status','source','tags'];

function diff(id1, id2) {
  const db = getDb();
  const a = db.prepare('SELECT * FROM memories WHERE id=?').get(id1);
  const b = db.prepare('SELECT * FROM memories WHERE id=?').get(id2);
  if (!a) throw new Error(`Memory not found: ${id1}`);
  if (!b) throw new Error(`Memory not found: ${id2}`);

  const fields = COMPARE_FIELDS.map(f => ({
    field: f,
    a: a[f] ?? null,
    b: b[f] ?? null,
    changed: String(a[f] ?? '') !== String(b[f] ?? ''),
  }));

  return {
    a: { id: a.id, title: a.title, created_at: a.created_at, updated_at: a.updated_at },
    b: { id: b.id, title: b.title, created_at: b.created_at, updated_at: b.updated_at },
    fields,
    content_diff: lineDiff(a.content, b.content),
    changed_count: fields.filter(f => f.changed).length,
    content_identical: a.content === b.content,
  };
}

module.exports = { diff, lineDiff, COMPARE_FIELDS };
