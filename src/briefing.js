'use strict';
const { search }              = require('./search');
const { search: semSearch }   = require('./semantic');
const { decayScore, stalest } = require('./decay');
const { topKeywords }         = require('./patterns');

const STALE_MS  = 14 * 86400000;
const TOKEN_EST = text => Math.ceil((text || '').length / 4);

async function generateBriefing(task, { projectId, budget = 1500, embedFn } = {}) {
  const kwResults = task ? search(task, { limit: 15, project_id: projectId }) : [];

  let semResults = [];
  if (task) {
    try {
      const raw = await semSearch(task, { limit: 10, projectId, embedFn });
      semResults = raw.filter(m => (m._sim || 0) >= 0.1); // skip truly unrelated results
    } catch {}
  }

  // Merge + dedup; track keyword rank for scoring.
  // For memories in both KW and sem results, update _sim on the existing merged entry
  // so the combined score gets both signals.
  const seen    = new Map(); // id → rank in kwResults (-1 if sem-only)
  const idxMap  = new Map(); // id → index in merged
  const merged  = [];
  kwResults.forEach((m, i) => {
    if (!seen.has(m.id)) {
      seen.set(m.id, i);
      idxMap.set(m.id, merged.length);
      merged.push(m);
    }
  });
  semResults.forEach(m => {
    if (seen.has(m.id)) {
      const idx = idxMap.get(m.id);
      if (idx !== undefined) merged[idx]._sim = m._sim; // propagate sim to KW entry
    } else {
      seen.set(m.id, -1);
      idxMap.set(m.id, merged.length);
      merged.push(m);
    }
  });

  // Re-rank: 40% keyword position + 40% semantic similarity + 20% decay
  const maxDecay = Math.max(...merged.map(m => decayScore(m)), 1);
  for (const m of merged) {
    const kwRank  = seen.get(m.id);
    const kwScore = kwRank >= 0 ? 1 - kwRank / Math.max(kwResults.length, 1) : 0;
    m._briefScore = 0.4 * kwScore + 0.4 * (m._sim || 0) + 0.2 * (decayScore(m) / maxDecay);
  }
  merged.sort((a, b) => b._briefScore - a._briefScore);

  // Stale memories not already surfaced
  const stale = stalest({ projectId, limit: 5 })
    .filter(s => !seen.has(s.id) && (Date.now() - (s.last_accessed_at || s.created_at)) > STALE_MS)
    .slice(0, 3);

  // Build markdown within budget
  let text = '', tokens = 0;
  const append = chunk => { text += chunk; tokens += TOKEN_EST(chunk); };

  append(task ? `# HIVE Briefing: ${task}\n\n` : '# HIVE Daily Briefing\n\n');

  if (merged.length) {
    append('## Relevant Memories\n\n');
    for (const m of merged) {
      const preview = (m.content || '').replace(/\n/g, ' ').slice(0, 200);
      const entry   = `**[${m.memory_type}] ${m.title}**\n${preview}\n\n`;
      if (tokens + TOKEN_EST(entry) > budget) break;
      append(entry);
    }
  } else {
    append('*No relevant memories found.*\n\n');
  }

  if (stale.length) {
    const sh = '## Needs Review\n\n';
    if (tokens + TOKEN_EST(sh) <= budget) {
      append(sh);
      for (const s of stale) {
        const days  = Math.round((Date.now() - (s.last_accessed_at || s.created_at)) / 86400000);
        const entry = `- **${s.title}** (${days} days since last access)\n`;
        if (tokens + TOKEN_EST(entry) > budget) break;
        append(entry);
      }
    }
  }

  return { text, tokenEstimate: tokens, memoryCount: merged.length, staleCount: stale.length };
}

async function dailyBriefing({ projectId, budget = 1500, embedFn } = {}) {
  const kw   = topKeywords({ days: 7, limit: 5, projectId });
  const task = kw.length ? kw.map(k => k.word).join(' ') : null;
  return generateBriefing(task, { projectId, budget, embedFn });
}

module.exports = { generateBriefing, dailyBriefing };
