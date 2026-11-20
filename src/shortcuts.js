'use strict';

// Shortcut definitions — consumed by server.js to generate both the
// keydown handler and the help overlay table.
const SHORTCUTS = [
  { key: '/',      guard: 'notInput', action: 'focusSearch',  description: 'Focus search box' },
  { key: 'n',      guard: 'notInput', action: 'newMemory',    description: 'New memory' },
  { key: 'm',      guard: 'notInput', action: 'goMemories',   description: 'Go to Memories tab' },
  { key: 'r',      guard: 'notInput', action: 'goReminders',  description: 'Go to Reminders tab' },
  { key: 'Escape', guard: 'always',   action: 'closeAll',     description: 'Close modal / clear focus' },
  { key: 'q',      guard: 'notInput', action: 'quickCapture', description: 'Quick capture a thought' },
  { key: '?',      guard: 'notInput', action: 'toggleHelp',   description: 'Show / hide shortcuts' },
];

module.exports = { SHORTCUTS };
