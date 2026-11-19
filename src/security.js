'use strict';

// Scan content for credential patterns before ingesting into HIVE.
// Returns the matched secret type name, or null if clean.
const PATTERNS = [
  [/sk-[a-zA-Z0-9_-]{20,}/, 'OpenAI/Anthropic API key'],
  [/xoxb-\d+-\d+-[a-zA-Z0-9]+/, 'Slack bot token'],
  [/xoxp-\d+-\d+-\d+-[a-zA-Z0-9]+/, 'Slack user token'],
  [/ghp_[a-zA-Z0-9]{36}/, 'GitHub personal access token'],
  [/AKIA[0-9A-Z]{16}/, 'AWS access key'],
  [/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, 'Private key'],
  [/"(password|passwd|token|api_key|secret|auth_token|access_token)"\s*:\s*"[^"]{6,}"/, 'Credential in JSON'],
  [/xoxb-[0-9]+-/, 'Slack token prefix'],
];

function scanForSecrets(text) {
  for (const [re, name] of PATTERNS) {
    if (re.test(text)) return name;
  }
  return null;
}

module.exports = { scanForSecrets };
