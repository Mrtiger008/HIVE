#!/usr/bin/env node
'use strict';

const memory   = require('./memory');
const projects = require('./projects');
const entities = require('./entities');
const graph    = require('./graph');
const { search }    = require('./search');
const { exportAll, backup } = require('./export');
const ingest   = require('./ingest');
const { decayScore, sweep, stalest } = require('./decay');
const { reinforce }  = require('./reinforce');
const { topKeywords } = require('./patterns');
const semantic = require('./semantic');

const [,, cmd, ...rawArgs] = process.argv;

// Parse --flag value pairs and the first bare positional arg
function parseArgs(args) {
  const flags = {};
  let positional = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) { flags[key] = next; i++; }
      else { flags[key] = true; }
    } else if (positional === null) {
      positional = args[i];
    }
  }
  return { flags, positional };
}

function fmt(m) {
  const tags = Array.isArray(m.tags) ? m.tags.join(', ') : '';
  return [
    `ID:         ${m.id}`,
    `Title:      ${m.title}`,
    `Type:       ${m.memory_type}`,
    `Trust:      ${m.trust_level}  confidence: ${m.confidence}`,
    `Importance: ${m.importance}/10  status: ${m.status}`,
    m.domain     ? `Domain:     ${m.domain}`     : null,
    m.project_id ? `Project:    ${m.project_id}` : null,
    tags         ? `Tags:       ${tags}`          : null,
    m.source     ? `Source:     ${m.source}`      : null,
    `Updated:    ${new Date(m.updated_at).toLocaleString()}`,
    '',
    m.content,
  ].filter(l => l !== null).join('\n');
}

function fmtEntity(e) {
  return [
    `ID:          ${e.id}`,
    `Name:        ${e.name}`,
    `Type:        ${e.entity_type}`,
    e.description        ? `Description: ${e.description}` : null,
    e.aliases?.length    ? `Aliases:     ${e.aliases.join(', ')}` : null,
    `Created:     ${new Date(e.created_at).toLocaleString()}`,
  ].filter(l => l !== null).join('\n');
}

function fmtProject(p) {
  return [
    `ID:         ${p.id}`,
    `Name:       ${p.name}`,
    `Status:     ${p.status}`,
    p.domain    ? `Domain:     ${p.domain}`    : null,
    p.objective ? `Objective:  ${p.objective}` : null,
    p.description ? `Description: ${p.description}` : null,
    `Updated:    ${new Date(p.updated_at).toLocaleString()}`,
  ].filter(l => l !== null).join('\n');
}

const COMMANDS = {

  // ── memory ───────────────────────────────────────────────────────────────

  'memory add'(args) {
    const { flags } = parseArgs(args);
    if (!flags.title || !flags.content) {
      die('Usage: hive memory add --title "..." --content "..." [--type semantic] [--domain D] [--project ID] [--trust OBSERVED] [--importance 5] [--tags "t1,t2"] [--source "..."] [--keywords "..."]');
    }
    const m = memory.add({
      title: flags.title,
      content: flags.content,
      memory_type: flags.type || 'semantic',
      domain: flags.domain,
      project_id: flags.project,
      trust_level: flags.trust || 'OBSERVED',
      importance: flags.importance ? +flags.importance : 5,
      tags: flags.tags ? flags.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
      source: flags.source,
      source_type: flags['source-type'],
      retrieval_keywords: flags.keywords,
    });
    console.log('Memory created:\n');
    console.log(fmt(m));
  },

  'memory get'(args) {
    const { positional } = parseArgs(args);
    if (!positional) die('Usage: hive memory get <id>');
    const m = memory.get(positional);
    if (!m) die(`Memory not found: ${positional}`);
    console.log(fmt(m));
  },

  'memory update'(args) {
    const { positional, flags } = parseArgs(args);
    if (!positional) die('Usage: hive memory update <id> [--title] [--content] [--trust] [--importance] [--status] [--tags]');
    const updates = {};
    if (flags.title)      updates.title      = flags.title;
    if (flags.content)    updates.content    = flags.content;
    if (flags.trust)      updates.trust_level = flags.trust;
    if (flags.importance) updates.importance = +flags.importance;
    if (flags.status)     updates.status     = flags.status;
    if (flags.domain)     updates.domain     = flags.domain;
    if (flags.tags)       updates.tags       = flags.tags.split(',').map(t => t.trim()).filter(Boolean);
    if (flags.keywords)   updates.retrieval_keywords = flags.keywords;
    const m = memory.update(positional, updates);
    console.log('Memory updated:\n');
    console.log(fmt(m));
  },

  'memory delete'(args) {
    const { positional } = parseArgs(args);
    if (!positional) die('Usage: hive memory delete <id>');
    const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`Delete memory ${positional}? (yes/no): `, ans => {
      rl.close();
      if (ans.trim().toLowerCase() === 'yes') {
        memory.remove(positional);
        console.log('Deleted.');
      } else {
        console.log('Cancelled.');
      }
    });
  },

  'memory list'(args) {
    const { flags } = parseArgs(args);
    const list = memory.list({
      type: flags.type, domain: flags.domain, project_id: flags.project,
      trust_level: flags.trust, status: flags.status,
      limit: flags.limit ? +flags.limit : 20,
    });
    if (!list.length) { console.log('No memories found.'); return; }
    for (const m of list) {
      console.log(`[${m.id.slice(0,8)}] [${m.memory_type.padEnd(9)}] [${m.trust_level.padEnd(16)}] i=${m.importance} ${m.title}`);
    }
    console.log(`\n${list.length} result(s)`);
  },

  // ── search ────────────────────────────────────────────────────────────────

  'search'(args) {
    const { positional, flags } = parseArgs(args);
    if (!positional) die('Usage: hive search "<query>" [--domain D] [--project ID] [--type T] [--limit 10]');
    const results = search(positional, {
      domain: flags.domain, project_id: flags.project,
      type: flags.type, limit: flags.limit ? +flags.limit : 10,
    });
    if (!results.length) { console.log('No results.'); return; }
    for (const m of results) {
      const preview = m.content.replace(/\n/g, ' ').substring(0, 160);
      console.log(`\n[${m.id.slice(0,8)}] [${m.memory_type}] [${m.trust_level}] ${m.title}`);
      console.log(`  ${preview}${m.content.length > 160 ? '…' : ''}`);
    }
    console.log(`\n${results.length} result(s)`);
  },

  // ── project ───────────────────────────────────────────────────────────────

  'project create'(args) {
    const { flags } = parseArgs(args);
    if (!flags.name) die('Usage: hive project create --name "..." [--objective "..."] [--domain "..."] [--description "..."]');
    const p = projects.create({
      name: flags.name, objective: flags.objective,
      description: flags.description, domain: flags.domain,
    });
    console.log('Project created:\n');
    console.log(fmtProject(p));
  },

  'project list'(args) {
    const { flags } = parseArgs(args);
    const list = projects.list({ status: flags.status, domain: flags.domain });
    if (!list.length) { console.log('No projects found.'); return; }
    for (const p of list) {
      console.log(`[${p.id.slice(0,8)}] [${p.status.padEnd(10)}] ${p.name}${p.domain ? `  (${p.domain})` : ''}`);
    }
  },

  'project get'(args) {
    const { positional } = parseArgs(args);
    if (!positional) die('Usage: hive project get <id>');
    const p = projects.get(positional);
    if (!p) die(`Project not found: ${positional}`);
    console.log(fmtProject(p));
    const mems = memory.list({ project_id: p.id, limit: 5 });
    if (mems.length) {
      console.log('\nRecent memories:');
      for (const m of mems) console.log(`  [${m.id.slice(0,8)}] [i=${m.importance}] ${m.title}`);
    }
  },

  'project update'(args) {
    const { positional, flags } = parseArgs(args);
    if (!positional) die('Usage: hive project update <id> [--name] [--status active|paused|completed|archived] [--objective] [--domain]');
    const updates = {};
    if (flags.name)        updates.name        = flags.name;
    if (flags.status)      updates.status      = flags.status;
    if (flags.objective)   updates.objective   = flags.objective;
    if (flags.description) updates.description = flags.description;
    if (flags.domain)      updates.domain      = flags.domain;
    const p = projects.update(positional, updates);
    console.log('Project updated:\n');
    console.log(fmtProject(p));
  },

  // ── entity ───────────────────────────────────────────────────────────────

  'entity add'(args) {
    const { flags } = parseArgs(args);
    if (!flags.name) die('Usage: hive entity add --name "..." [--type person|tool|org|concept|project|file|domain|other] [--description "..."] [--aliases "a,b"]');
    const e = entities.create({
      name: flags.name,
      entity_type: flags.type || 'other',
      description: flags.description,
      aliases: flags.aliases ? flags.aliases.split(',').map(a => a.trim()).filter(Boolean) : [],
    });
    console.log('Entity created:\n');
    console.log(fmtEntity(e));
  },

  'entity get'(args) {
    const { positional } = parseArgs(args);
    if (!positional) die('Usage: hive entity get <id>');
    const e = entities.get(positional);
    if (!e) die(`Entity not found: ${positional}`);
    console.log(fmtEntity(e));
    const nbrs = graph.neighbors(e.id, { limit: 5 });
    if (nbrs.length) {
      console.log('\nRelationships:');
      for (const n of nbrs)
        console.log(`  ${n.direction === 'out' ? '→' : '←'} [${n.rel_type}] ${n.name} (${n.entity_type})`);
    }
  },

  'entity list'(args) {
    const { flags } = parseArgs(args);
    const list = entities.list({ entity_type: flags.type, limit: flags.limit ? +flags.limit : 50 });
    if (!list.length) { console.log('No entities found.'); return; }
    for (const e of list)
      console.log(`[${e.id.slice(0,8)}] [${e.entity_type.padEnd(8)}] ${e.name}${e.aliases.length ? `  (${e.aliases.join(', ')})` : ''}`);
    console.log(`\n${list.length} result(s)`);
  },

  'entity find'(args) {
    const { positional } = parseArgs(args);
    if (!positional) die('Usage: hive entity find "<name>"');
    const results = entities.findByName(positional);
    if (!results.length) { console.log('No entities found.'); return; }
    for (const e of results)
      console.log(`[${e.id.slice(0,8)}] [${e.entity_type.padEnd(8)}] ${e.name}${e.aliases.length ? `  aliases: ${e.aliases.join(', ')}` : ''}`);
  },

  'entity link'(args) {
    const { flags } = parseArgs(args);
    if (!flags.from || !flags.rel || !flags.to)
      die('Usage: hive entity link --from <id> --rel <REL_TYPE> --to <id> [--confidence 0.9] [--notes "..."]');
    const rel = graph.link({
      from_id: flags.from, rel_type: flags.rel, to_id: flags.to,
      confidence: flags.confidence ? +flags.confidence : 0.5,
      notes: flags.notes,
    });
    console.log(`Relationship created: ${rel.id}`);
    const from = entities.get(rel.from_id);
    const to   = entities.get(rel.to_id);
    console.log(`  ${from.name}  --[${rel.rel_type}]-->  ${to.name}`);
  },

  'entity merge'(args) {
    const { flags } = parseArgs(args);
    if (!flags.keep || !flags.drop) die('Usage: hive entity merge --keep <id> --drop <id>');
    const kept = entities.merge(flags.keep, flags.drop);
    console.log(`Merged. Kept entity:\n`);
    console.log(fmtEntity(kept));
  },

  // ── graph ─────────────────────────────────────────────────────────────────

  'graph neighbors'(args) {
    const { positional, flags } = parseArgs(args);
    if (!positional) die('Usage: hive graph neighbors <entity_id> [--direction out|in|both] [--rel REL_TYPE] [--limit N]');
    const e = entities.get(positional);
    if (!e) die(`Entity not found: ${positional}`);
    const nbrs = graph.neighbors(positional, {
      direction: flags.direction || 'both',
      relType: flags.rel,
      limit: flags.limit ? +flags.limit : 20,
    });
    if (!nbrs.length) { console.log('No neighbors found.'); return; }
    console.log(`Neighbors of "${e.name}":\n`);
    for (const n of nbrs)
      console.log(`  ${n.direction === 'out' ? '→' : '←'} [${n.rel_type}] ${n.name} (${n.entity_type})  conf=${n.rel_confidence}`);
  },

  'graph related'(args) {
    const { positional, flags } = parseArgs(args);
    if (!positional) die('Usage: hive graph related <entity_id> [--limit N]');
    const e = entities.get(positional);
    if (!e) die(`Entity not found: ${positional}`);
    const mems = graph.relatedMemories(positional, flags.limit ? +flags.limit : 10);
    if (!mems.length) { console.log(`No memories mention "${e.name}".`); return; }
    console.log(`Memories mentioning "${e.name}":\n`);
    for (const m of mems) {
      const preview = m.content.replace(/\n/g, ' ').substring(0, 120);
      console.log(`[${m.id.slice(0,8)}] [${m.memory_type}] ${m.title}`);
      console.log(`  ${preview}${m.content.length > 120 ? '…' : ''}\n`);
    }
  },

  // ── session / ingest ──────────────────────────────────────────────────────

  'session import'(args) {
    const { positional, flags } = parseArgs(args);
    if (!positional) die('Usage: hive session import <path/to/session.jsonl> [--auto] [--project <id>] [--limit N]');
    const auto = flags.auto === true || flags.auto === 'true';
    const { proposals, stored } = ingest.fromSession(positional, {
      projectId: flags.project || null,
      auto,
      maxProposals: flags.limit ? +flags.limit : 15,
    });

    if (auto) {
      console.log(`Stored ${stored.length} memories (${proposals.length - stored.length} already existed).`);
      for (const m of stored) console.log(`  [${m.id.slice(0,8)}] [${m.memory_type}] ${m.title}`);
    } else {
      console.log(`Found ${proposals.length} proposals (dry-run — add --auto to store):\n`);
      proposals.forEach((p, i) => {
        console.log(`${i + 1}. [${p.memory_type}] [${p.trust_level}] ${p.title}`);
        console.log(`   ${p.content.replace(/\n/g, ' ').slice(0, 120)}${p.content.length > 120 ? '…' : ''}\n`);
      });
    }
  },

  'ingest'(args) {
    const { flags } = parseArgs(args);
    const auto = flags.auto === true || flags.auto === 'true';
    const { proposals, stored } = ingest.fromClaudeMem({
      project:   flags.project || '',
      limit:     flags.limit ? +flags.limit : 50,
      auto,
      projectId: flags['project-id'] || null,
    });

    if (auto) {
      console.log(`Ingested ${stored.length} memories from claude-mem (${proposals.length - stored.length} already existed).`);
      for (const m of stored) console.log(`  [${m.id.slice(0,8)}] [${m.memory_type}] ${m.title}`);
    } else {
      console.log(`Found ${proposals.length} claude-mem observations (dry-run — add --auto to store):\n`);
      proposals.slice(0, 20).forEach((p, i) => {
        console.log(`${i + 1}. [${p._cm_id}] [${p.memory_type}] ${p.title}`);
        console.log(`   ${p.content.replace(/\n/g, ' ').slice(0, 100)}${p.content.length > 100 ? '…' : ''}\n`);
      });
      if (proposals.length > 20) console.log(`  … and ${proposals.length - 20} more`);
    }
  },

  // ── semantic search ───────────────────────────────────────────────────────

  'semantic'(args) {
    const { positional, flags } = parseArgs(args);
    if (!positional) die('Usage: hive semantic "<query>" [--limit N] [--project <id>] [--hybrid]');
    const hybrid = flags.hybrid === true || flags.hybrid === 'true';
    const limit  = flags.limit ? +flags.limit : 10;
    semantic.search(positional, { limit, projectId: flags.project || null, hybrid })
      .then(results => {
        if (!results.length) { console.log('No semantic matches found.\n(Run "hive embed backfill" to index memories.)'); return; }
        const scoreKey = hybrid ? '_hybrid' : '_sim';
        for (const m of results) {
          const score = (m[scoreKey] * 100).toFixed(0);
          const preview = m.content.replace(/\n/g, ' ').substring(0, 140);
          console.log(`\n[${m.id.slice(0,8)}] [${m.memory_type}] [sim=${score}%] ${m.title}`);
          console.log(`  ${preview}${m.content.length > 140 ? '…' : ''}`);
        }
        console.log(`\n${results.length} result(s)`);
      })
      .catch(err => { console.error(`Error: ${err.message}`); process.exit(1); });
  },

  'embed backfill'(args) {
    const { flags } = parseArgs(args);
    console.log('Embedding memories… (downloads ~23 MB model on first run)');
    semantic.backfill({ limit: flags.limit ? +flags.limit : 500 })
      .then(count => console.log(`Done — ${count} memories embedded.`))
      .catch(err => { console.error(`Error: ${err.message}`); process.exit(1); });
  },

  // ── learning system ───────────────────────────────────────────────────────

  'suggest'(args) {
    const { flags } = parseArgs(args);
    const results = stalest({ projectId: flags.project || null, limit: flags.limit ? +flags.limit : 5 });
    if (!results.length) { console.log('No memories found.'); return; }
    console.log('Memories most in need of review (stalest first):\n');
    for (const m of results) {
      const score = m.decay_score.toFixed(2);
      const accessed = m.last_accessed_at
        ? `accessed ${Math.round((Date.now() - m.last_accessed_at) / 86400000)}d ago`
        : 'never accessed';
      console.log(`[${m.id.slice(0,8)}] [i=${m.importance}] [score=${score}] (${accessed}) ${m.title}`);
    }
    console.log(`\nRun: hive reinforce <id>  to bump a memory's importance`);
  },

  'patterns'(args) {
    const { flags } = parseArgs(args);
    const keywords = topKeywords({
      days: flags.days ? +flags.days : 30,
      limit: flags.limit ? +flags.limit : 15,
      projectId: flags.project || null,
    });
    if (!keywords.length) { console.log('No memories in this window.'); return; }
    console.log(`Top recurring topics (last ${flags.days || 30} days):\n`);
    for (const { word, count } of keywords) {
      const bar = '█'.repeat(Math.min(count, 20));
      console.log(`  ${word.padEnd(24)} ${bar} (${count})`);
    }
  },

  'reinforce'(args) {
    const { positional } = parseArgs(args);
    if (!positional) die('Usage: hive reinforce <memory-id>');
    const result = reinforce(positional);
    if (!result) die(`Memory not found: ${positional}`);
    console.log(`Reinforced [${positional.slice(0,8)}] — importance now ${result.importance}/10`);
  },

  'decay sweep'() {
    const changed = sweep();
    console.log(`Decay sweep complete — ${changed} memories marked OUTDATED (90+ days idle)`);
  },

  // ── utility ───────────────────────────────────────────────────────────────

  'export'() {
    console.log('Exporting all active memories to Markdown…');
    const count = exportAll();
    console.log(`Done — ${count} memories written to memory/`);
  },

  'backup'() {
    console.log('Creating backup…');
    const dest = backup();
    console.log(`Backup saved: ${dest}`);
  },

  'context'(args) {
    const { positional, flags } = parseArgs(args);
    if (!positional) {
      die('Usage: hive context "<task description>" [--project ID] [--budget 2000] [--cross-project] [--json]');
    }
    const { buildContext } = require('./context');
    const result = buildContext(positional, {
      projectId:    flags.project || null,
      budget:       flags.budget ? +flags.budget : 2000,
      crossProject: flags['cross-project'] === true || flags['cross-project'] === 'true',
    });

    if (flags.json) { console.log(JSON.stringify(result, null, 2)); return; }

    const HR = '─'.repeat(60);
    console.log('\nTask analysis');
    console.log(HR);
    console.log(`Input:   "${result.task}"`);
    if (result.domain) {
      console.log(`Domain:  ${result.domain.name}  (confidence: ${result.domain.confidence})`);
    } else {
      console.log('Domain:  not detected');
    }
    if (result.project) {
      console.log(`Project: ${result.project.name}  [${result.project.id.slice(0,8)}]  (match: ${Math.round(result.project.confidence * 100)}%)`);
    } else {
      console.log('Project: none detected');
    }

    if (result.warnings.length) {
      console.log('\nWarnings');
      console.log(HR);
      for (const w of result.warnings) {
        console.log(`⚠  ${w.message}`);
        if (w.alternatives) {
          for (const a of w.alternatives) {
            console.log(`   • ${a.name} [${a.id.slice(0,8)}]  (match: ${Math.round(a.score * 100)}%)`);
          }
        }
      }
    }

    console.log(`\nContext pack  [~${result.tokenEstimate} / ${result.budget} tokens]`);
    console.log(HR);

    if (result.project) {
      console.log('[PROJECT]');
      console.log(`Name:   ${result.project.name}`);
      if (result.project.objective) console.log(`Goal:   ${result.project.objective}`);
      console.log(`Status: ${result.project.status}`);
    }

    if (result.memories.length) {
      console.log(`\n[MEMORIES — ${result.memories.length} retrieved]`);
      result.memories.forEach((m, i) => {
        const preview = m.content.replace(/\n/g, ' ').substring(0, 120);
        const src = m._source ? ` {${m._source}}` : '';
        console.log(`\n${i + 1}. [${m.memory_type}] [${m.trust_level}] i=${m.importance}${src}  ${m.title}`);
        console.log(`   ${preview}${m.content.length > 120 ? '…' : ''}`);
        if (m.source) console.log(`   Source: ${m.source}`);
      });
    } else {
      console.log('\n[MEMORIES — none found]');
      if (result.project) {
        console.log(`  Add memories: hive memory add --project ${result.project.id} --title "..." --content "..."`);
      }
    }

    if (result.skills.length) {
      console.log(`\n[SKILLS — ${result.skills.length} found]`);
      for (const s of result.skills) console.log(`  • ${s.title}`);
    }
    console.log('');
  },

  'help'() {
    console.log(`
HIVE — Personal AI Knowledge & Memory System

Semantic search:
  hive semantic "<query>"  [--limit N] [--project <id>] [--hybrid]
  hive embed backfill      [--limit N]   Index memories (downloads model on first run)

Learning system:
  hive suggest      [--project <id>] [--limit N]       Stale memories ranked by decay score
  hive patterns     [--days 30] [--limit 15] [--project <id>]  Top recurring keywords
  hive reinforce    <id>                                Bump a memory's importance (+1, max 10)
  hive decay sweep                                     Mark 90+-day idle memories as OUTDATED

Session & ingest commands:
  hive session import <path.jsonl>  [--auto] [--project <id>] [--limit N]
  hive ingest                       [--project <name>] [--limit N] [--auto] [--project-id <id>]

Entity commands:
  hive entity add    --name "..." [--type person|tool|org|concept|project|file|domain|other] [--description "..."] [--aliases "a,b"]
  hive entity get    <id>
  hive entity list   [--type TYPE] [--limit N]
  hive entity find   "<name>"
  hive entity link   --from <id> --rel <REL_TYPE> --to <id> [--confidence 0.9] [--notes "..."]
  hive entity merge  --keep <id> --drop <id>

Graph commands:
  hive graph neighbors <entity_id>  [--direction out|in|both] [--rel REL_TYPE] [--limit N]
  hive graph related   <entity_id>  [--limit N]

Memory commands:
  hive memory add     --title "…" --content "…" [--type TYPE] [--domain D] [--project ID]
                      [--trust LEVEL] [--importance N] [--tags "t1,t2"] [--source "…"] [--keywords "…"]
  hive memory get     <id>
  hive memory update  <id>  [--title] [--content] [--trust] [--importance] [--status] [--tags] [--domain] [--keywords]
  hive memory delete  <id>
  hive memory list    [--type TYPE] [--domain D] [--project ID] [--trust LEVEL] [--status S] [--limit N]

Search:
  hive search "<query>"  [--domain D] [--project ID] [--type T] [--limit N]

Context router:
  hive context "<task>"  [--project ID] [--budget 2000] [--cross-project] [--json]

Project commands:
  hive project create --name "…" [--objective "…"] [--domain "…"] [--description "…"]
  hive project list   [--status active|paused|completed|archived] [--domain D]
  hive project get    <id>
  hive project update <id>  [--name] [--status] [--objective] [--description] [--domain]

Utility:
  hive export    Export all active memories to Markdown files
  hive backup    Create a timestamped SQLite backup
  hive help      Show this help

Memory types:  core | domain | project | episodic | semantic | skill
Trust levels:  USER_CONFIRMED | SOURCE_VERIFIED | OBSERVED | INFERRED | AI_HYPOTHESIS | CONFLICTED | OUTDATED | UNKNOWN

Context router notes:
  --budget N         Max tokens in context pack (default 2000)
  --cross-project    Include memories from all projects (default: project-isolated)
  --json             Output raw JSON for programmatic use

Memory types:  core | domain | project | episodic | semantic | skill
Trust levels:  USER_CONFIRMED | SOURCE_VERIFIED | OBSERVED | INFERRED | AI_HYPOTHESIS | CONFLICTED | OUTDATED | UNKNOWN
`);
  },
};

function die(msg) {
  console.error(msg);
  process.exit(1);
}

// Dispatch: try two-word command first, then single-word
function main() {
  if (!cmd) { COMMANDS.help(); return; }
  const twoWord = `${cmd} ${rawArgs[0]}`;
  if (COMMANDS[twoWord]) { COMMANDS[twoWord](rawArgs.slice(1)); return; }
  if (COMMANDS[cmd])     { COMMANDS[cmd](rawArgs); return; }
  die(`Unknown command: ${cmd}\nRun "hive help" for available commands.`);
}

try {
  main();
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
