/* eslint-disable no-console */
import { loadConfig } from './config.mjs';
import { postComment, runRepro } from './index.mjs';

const { GITHUB_TOKEN, ISSUE_NUMBER, REPO } = process.env;

if (!GITHUB_TOKEN || !ISSUE_NUMBER || !REPO) {
  throw new Error('GITHUB_TOKEN, ISSUE_NUMBER and REPO are required.');
}

// provider -> the env var holding its key. Captured here and handed to the library so
// it works regardless of how each pi provider names its env var.
const PROVIDER_KEY_ENV = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GOOGLE_GENERATIVE_AI_API_KEY',
};

// Tokens the agent must never see. The report is untrusted input; a prompt-injected
// tool call could otherwise `printenv` these and exfiltrate them.
const SECRET_ENV = [
  ...Object.values(PROVIDER_KEY_ENV),
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'AI_REPRO_TOKEN',
  'ACTIONS_ID_TOKEN_REQUEST_TOKEN',
  'ACTIONS_ID_TOKEN_REQUEST_URL',
  'ACTIONS_RUNTIME_TOKEN',
];

const providerApiKeys = {};
for (const [provider, envName] of Object.entries(PROVIDER_KEY_ENV)) {
  if (process.env[envName]) {
    providerApiKeys[provider] = process.env[envName];
  }
}

const inputs = {
  githubToken: GITHUB_TOKEN,
  issueNumber: ISSUE_NUMBER,
  repo: REPO,
  mention: process.env.AI_REPRO_MENTION || '@repro-bot',
  config: await loadConfig(),
  providerApiKeys,
};

// All secrets are captured into `inputs` above; scrub them from the environment before
// the library runs so the agent's tool subprocesses can't read them.
for (const name of SECRET_ENV) {
  delete process.env[name];
}

const issueRef = { githubToken: GITHUB_TOKEN, repo: REPO, issueNumber: ISSUE_NUMBER };

try {
  const result = await runRepro(inputs);
  if (result.comment) {
    await postComment(issueRef, result.comment);
  }
  console.log(`Done (${result.status}).${result.prUrl ? ` Draft PR: ${result.prUrl}` : ''}`);
} catch (err) {
  console.error(err);
  try {
    await postComment(
      issueRef,
      `🤖 AI repro agent failed: \`${String(err.message || err).slice(0, 500)}\``,
    );
  } catch {
    // best-effort
  }
  process.exit(1);
}
