'use strict';

function tokenize(text) {
  return new Set(String(text || '').toLowerCase().match(/\b\w{3,}\b/g) || []);
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

// Weighted: title similarity counts more than content (title is denser signal)
function similarity(titleA, contentA, titleB, contentB) {
  const tScore = jaccard(tokenize(titleA), tokenize(titleB));
  const cScore = jaccard(tokenize(contentA), tokenize(contentB));
  return tScore * 0.6 + cScore * 0.4;
}

function findSimilar(title, content, { limit = 5, threshold = 0.25 } = {}) {
  const memory = require('./memory');
  return memory.list({ limit: 500 })
    .map(m => ({ ...m, _score: similarity(title, content, m.title, m.content) }))
    .filter(m => m._score >= threshold)
    .sort((a, b) => b._score - a._score)
    .slice(0, limit);
}

module.exports = { similarity, findSimilar };
