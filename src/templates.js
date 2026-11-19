'use strict';

// Built-in templates keyed by memory_type.
// Each template pre-fills the add modal with sensible defaults for that type.
const TEMPLATES = {
  core: {
    memory_type:    'core',
    title_hint:     'Core principle: ',
    content_hint:   'What is the principle?\n\nWhy it matters:\n\nExceptions:',
    trust_level:    'USER_CONFIRMED',
    importance:     8,
    confidence:     0.9,
    tags:           [],
  },
  domain: {
    memory_type:    'domain',
    title_hint:     '',
    content_hint:   'Context:\n\nKey facts:\n\nSources:',
    trust_level:    'SOURCE_VERIFIED',
    importance:     6,
    confidence:     0.75,
    tags:           [],
  },
  project: {
    memory_type:    'project',
    title_hint:     'Decision: ',
    content_hint:   'Decision:\n\nRationale:\n\nAlternatives considered:\n\nOutcome:',
    trust_level:    'OBSERVED',
    importance:     7,
    confidence:     0.8,
    tags:           [],
  },
  episodic: {
    memory_type:    'episodic',
    title_hint:     '',
    content_hint:   'What happened:\n\nWho was involved:\n\nOutcome / follow-up:',
    trust_level:    'OBSERVED',
    importance:     5,
    confidence:     0.7,
    tags:           [],
  },
  semantic: {
    memory_type:    'semantic',
    title_hint:     '',
    content_hint:   '',
    trust_level:    'OBSERVED',
    importance:     5,
    confidence:     0.5,
    tags:           [],
  },
  skill: {
    memory_type:    'skill',
    title_hint:     'How to: ',
    content_hint:   'Steps:\n1. \n2. \n3. \n\nGotchas:\n\nExample:',
    trust_level:    'SOURCE_VERIFIED',
    importance:     7,
    confidence:     0.8,
    tags:           ['howto'],
  },
};

function list() {
  return Object.values(TEMPLATES);
}

function get(memoryType) {
  return TEMPLATES[memoryType] || TEMPLATES.semantic;
}

module.exports = { list, get };
