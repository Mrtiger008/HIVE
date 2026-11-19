'use strict';
// Embedding generation via @huggingface/transformers (ONNX, runs fully local).
// Model: Xenova/all-MiniLM-L6-v2 — 384-dim, ~23 MB, downloads once to database/models/.
// Disk cache: database/embeddings/<hash>.json — avoids re-embedding unchanged content.

const fs   = require('fs');
const path = require('path');
const { getDb } = require('./db');

const MODEL_ID     = 'Xenova/all-MiniLM-L6-v2';
const EMBED_DIR    = path.join(__dirname, '..', 'database', 'embeddings');
const MODEL_DIR    = path.join(__dirname, '..', 'database', 'models');

let _extractor = null;

// djb2 hash — same as ingest.js, kept local to avoid circular dep
function _hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
  return (h >>> 0).toString(16);
}

// Raw embed — calls the model. Returns a plain number[].
async function embed(text) {
  if (!_extractor) {
    const { pipeline, env } = require('@huggingface/transformers');
    env.cacheDir = MODEL_DIR;
    _extractor = await pipeline('feature-extraction', MODEL_ID, { device: 'cpu' });
  }
  const out = await _extractor(text.slice(0, 512), { pooling: 'mean', normalize: true });
  return Array.from(out.data);
}

// Cached embed — returns from disk if available, else runs model and writes to disk.
async function embedCached(text) {
  fs.mkdirSync(EMBED_DIR, { recursive: true });
  const key  = _hash(text);
  const file = path.join(EMBED_DIR, `${key}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const vec = await embed(text);
  fs.writeFileSync(file, JSON.stringify(vec));
  return vec;
}

// Store an embedding on a memory row (and in the disk cache).
async function embedMemory(memory, { embedFn = embedCached } = {}) {
  const text = `${memory.title} ${memory.content}`;
  const vec  = await embedFn(text);
  getDb().prepare('UPDATE memories SET embedding = ? WHERE id = ?')
    .run(JSON.stringify(vec), memory.id);
  return vec;
}

module.exports = { embed, embedCached, embedMemory, MODEL_ID };
