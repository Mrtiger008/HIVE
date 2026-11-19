'use strict';
// Context Router — the core of HIVE's retrieval.
// Given a task description, assembles a ranked context pack:
//   project detected → scoped memories → skills → domain memories
// within a configurable token budget.

const { search } = require('./search');
const { list: listProjects, get: getProject } = require('./projects');

// ── Helpers ───────────────────────────────────────────────────────────────

// Approximate tokens: Claude tokenises ~4 chars per token on average.
function approxTokens(text) {
  return Math.ceil((text || '').length / 4);
}

// Recency multiplier: 1.0 today, 0.5 at 30 days, 0.25 at 90 days.
function recencyDecay(updatedAt, now) {
  const days = (now - updatedAt) / 86_400_000;
  return 1 / (1 + days / 30);
}

// Normalise query into lower-case words ≥3 chars (strips punctuation).
function tokenise(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length >= 3);
}

// ── Domain detection ──────────────────────────────────────────────────────

// Keyword hints per domain. Add more as HIVE learns real domains.
const DOMAIN_HINTS = {
  'data-analytics':       ['sql', 'query', 'snowflake', 'bigquery', 'redash', 'jarvis',
                           'analytics', 'report', 'dashboard', 'metrics', 'reconciliation',
                           'join', 'table', 'column', 'cte', 'aggregate', 'filter', 'count'],
  'software-engineering': ['code', 'function', 'debug', 'api', 'node', 'python', 'script',
                           'module', 'error', 'bug', 'deploy', 'git', 'npm', 'test', 'build',
                           'hive', 'sqlite', 'schema', 'cli'],
  'professional-work':    ['slack', 'email', 'meeting', 'campaign', 'amazon', 'urban',
                           'escalation', 'pipeline', 'automation', 'complaint', 'order',
                           'installation', 'seller', 'central'],
  'personal':             ['travel', 'book', 'plan', 'personal', 'finance', 'budget', 'health'],
};

function detectDomain(queryWords, projects) {
  const scores = {};

  // Score keyword hints
  for (const [domain, hints] of Object.entries(DOMAIN_HINTS)) {
    scores[domain] = queryWords.filter(w => hints.includes(w)).length;
  }

  // Boost domains from matching project names/objectives (weight ×2)
  for (const p of projects) {
    if (!p.domain) continue;
    const pscore = _scoreProject(p, queryWords);
    if (pscore > 0) {
      scores[p.domain] = (scores[p.domain] || 0) + pscore * 2;
    }
  }

  const ranked = Object.entries(scores).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return null;

  const [domain, score] = ranked[0];
  return { domain, confidence: score > 2 ? 'high' : score > 0.5 ? 'medium' : 'low' };
}

// ── Project identification ─────────────────────────────────────────────────

// Common function words that add noise to project matching (≥3 chars to survive tokenise)
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'are', 'was', 'has',
  'have', 'can', 'will', 'may', 'not', 'but', 'from', 'via', 'its',
  'how', 'what', 'why', 'when', 'does', 'did', 'been', 'into', 'about',
]);

function _scoreProject(project, queryWords) {
  const words = queryWords.filter(w => !STOP_WORDS.has(w));
  if (!words.length) return 0;
  // Domain field is a tag, not descriptive text — exclude it to avoid false substring matches
  const haystack = [project.name, project.objective, project.description]
    .filter(Boolean).join(' ').toLowerCase();
  return words.filter(w => haystack.includes(w)).length / words.length;
}

function identifyProject(queryWords, allProjects) {
  return allProjects
    .map(p => ({ project: p, score: _scoreProject(p, queryWords) }))
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score);
}

// ── Core: build context pack ───────────────────────────────────────────────

function buildContext(task, { projectId, budget = 2000, crossProject = false } = {}) {
  if (!task?.trim()) throw new Error('task is required');
  const now = Date.now();
  const queryWords = tokenise(task);

  // Load all active projects (we need them for domain detection + project scoring)
  const allProjects = listProjects({ status: 'active', limit: 100 });

  // ── Project identification ───────────────────────────────────────────────
  let detectedProject = null;
  let projectCandidates = [];

  if (projectId) {
    detectedProject = getProject(projectId);
    if (!detectedProject) throw new Error(`Project not found: ${projectId}`);
  } else {
    projectCandidates = identifyProject(queryWords, allProjects);
    if (projectCandidates.length) detectedProject = projectCandidates[0].project;
  }

  // ── Domain detection ─────────────────────────────────────────────────────
  const domainResult = detectDomain(queryWords, allProjects);
  const domain = domainResult?.domain || detectedProject?.domain || null;

  // ── Warnings ─────────────────────────────────────────────────────────────
  const warnings = [];

  // Ambiguous project: second candidate within 50% of top score
  if (!projectId && projectCandidates.length > 1) {
    const topScore = projectCandidates[0].score;
    const ambiguous = projectCandidates.filter(c => c !== projectCandidates[0] && c.score >= topScore * 0.5);
    if (ambiguous.length) {
      warnings.push({
        type: 'ambiguous_project',
        message: 'Multiple projects partially match — verify the detected project is correct',
        alternatives: ambiguous.slice(0, 3).map(c => ({
          id: c.project.id,
          name: c.project.name,
          score: Math.round(c.score * 100) / 100,
        })),
      });
    }
  }

  // Low-confidence domain
  if (!domain) {
    warnings.push({ type: 'no_domain', message: 'Could not detect domain — returning global search results' });
  }

  // ── Memory retrieval ─────────────────────────────────────────────────────
  const seen = new Set();

  function dedup(mems, source) {
    return mems.filter(m => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      m._source = source;
      return true;
    });
  }

  // 1. Project-scoped (highest signal)
  const projectMems = detectedProject
    ? dedup(search(task, { project_id: detectedProject.id, limit: 15 }), 'project')
    : [];

  // 2. Skills (task-intent based, never project-scoped — they're global)
  const skillMems = dedup(search(task, { type: 'skill', limit: 8 }), 'skill');

  // 3. Domain-scoped semantic/core memories
  const domainMems = domain
    ? dedup(search(task, { domain, limit: 10 }), 'domain')
    : [];

  // 4. Cross-project — only when explicitly requested
  const crossMems = crossProject
    ? dedup(search(task, { limit: 10 }), 'cross')
    : [];

  // ── Rank all retrieved memories ───────────────────────────────────────────
  const SOURCE_WEIGHT = { project: 1.4, skill: 1.3, domain: 1.0, cross: 0.8 };

  const all = [...projectMems, ...skillMems, ...domainMems, ...crossMems].map(m => {
    const recency   = recencyDecay(m.updated_at, now);
    const srcWeight = SOURCE_WEIGHT[m._source] ?? 1.0;
    const score     = m.confidence * (m.importance / 10) * recency * srcWeight;
    return { ...m, _score: score };
  }).sort((a, b) => b._score - a._score);

  // ── Token budget ─────────────────────────────────────────────────────────
  let tokenCount = 0;

  // Reserve tokens for project header
  if (detectedProject) {
    tokenCount += approxTokens(
      [detectedProject.name, detectedProject.objective, detectedProject.description].join(' ')
    );
  }

  const withinBudget = [];
  for (const m of all) {
    const cost = approxTokens(m.title + ' ' + m.content);
    if (tokenCount + cost > budget) break;
    tokenCount += cost;
    withinBudget.push(m);
  }

  // ── Confidence check ──────────────────────────────────────────────────────
  if (!withinBudget.length && !detectedProject) {
    warnings.push({ type: 'low_confidence', message: 'No memories found for this task. Add memories with: hive memory add' });
  }

  return {
    task,
    domain: domain ? { name: domain, confidence: domainResult?.confidence || 'low' } : null,
    project: detectedProject ? {
      id:         detectedProject.id,
      name:       detectedProject.name,
      objective:  detectedProject.objective || null,
      status:     detectedProject.status,
      domain:     detectedProject.domain || null,
      confidence: projectId ? 1.0 : Math.round((projectCandidates[0]?.score ?? 0) * 100) / 100,
    } : null,
    memories:      withinBudget,
    skills:        withinBudget.filter(m => m.memory_type === 'skill'),
    warnings,
    tokenEstimate: tokenCount,
    budget,
  };
}

module.exports = { buildContext };
