/* eslint-disable no-console */
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.mjs';
import { runRepro } from './repro.mjs';
import { runReview } from './review.mjs';

// The task to run is chosen by the pre-fetched context (issue => repro, PR => review).
const TASKS = { repro: runRepro, review: runReview };

// This process never talks to GitHub: the issue context is pre-fetched into a JSON file
// by the workflow, and all results are written to files for later steps to act on.
const { AI_REPRO_CONTEXT, AI_REPRO_OUTPUT_DIR } = process.env;

if (!AI_REPRO_CONTEXT || !AI_REPRO_OUTPUT_DIR) {
  throw new Error('AI_REPRO_CONTEXT (path to context JSON) and AI_REPRO_OUTPUT_DIR are required.');
}

const outDir = path.resolve(AI_REPRO_OUTPUT_DIR);
fs.mkdirSync(outDir, { recursive: true });

// Tee console output into artifact files: logs.txt for regular logs, errors.txt for
// errors. index.mjs only uses console.log/error, so patching these captures everything.
function tee(file, original) {
  return (...args) => {
    const line = args
      .map((a) => {
        if (a instanceof Error) {
          return a.stack || String(a);
        }
        return typeof a === 'string' ? a : JSON.stringify(a);
      })
      .join(' ');
    fs.appendFileSync(file, `[${new Date().toISOString()}] ${line}\n`);
    original(...args);
  };
}
console.log = tee(path.join(outDir, 'logs.txt'), console.log.bind(console));
console.error = tee(path.join(outDir, 'errors.txt'), console.error.bind(console));

// provider -> the env var holding its key. Captured here and handed to the library so
// it works regardless of how each pi provider names its env var.
const PROVIDER_KEY_ENV = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GOOGLE_GENERATIVE_AI_API_KEY',
};

// Tokens the agent must never see. The report is untrusted input; a prompt-injected
// tool call could otherwise `printenv` these and exfiltrate them. GitHub tokens are in
// the list defensively — the workflow must not pass them to this step at all.
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

const context = JSON.parse(fs.readFileSync(AI_REPRO_CONTEXT, 'utf8'));

const task = context.task || 'repro';
const runTask = TASKS[task];
if (!runTask) {
  throw new Error(`Unknown task "${task}" in the context file.`);
}

const inputs = {
  context,
  mention: process.env.AI_REPRO_MENTION || '@repro-bot',
  config: await loadConfig(task),
  providerApiKeys,
};

// All secrets are captured into `inputs` above; scrub them from the environment before
// the library runs so the agent's tool subprocesses can't read them.
for (const name of SECRET_ENV) {
  delete process.env[name];
}

// result.json drives the follow-up workflow steps (push, PR, canary pin); result.md is
// the issue comment body (may contain {{PR_URL}}/{{PR_NUMBER}} placeholders); pr-body.md
// is the draft PR description.
function writeOutputs({ comment, prBody, ...meta }) {
  fs.writeFileSync(path.join(outDir, 'result.json'), `${JSON.stringify(meta, null, 2)}\n`);
  if (comment) {
    fs.writeFileSync(path.join(outDir, 'result.md'), `${comment}\n`);
  }
  if (prBody) {
    fs.writeFileSync(path.join(outDir, 'pr-body.md'), `${prBody}\n`);
  }
}

try {
  const result = await runTask(inputs);
  writeOutputs(result);
  console.log(`Done (${result.status}).`);
} catch (err) {
  console.error(err);
  writeOutputs({
    status: 'failed',
    comment:
      `🤖 AI ${task} agent failed: ` +
      `\`${String(err.message || err).slice(0, 500)}\`\n\n` +
      'See the workflow run artifacts for logs.',
  });
  process.exit(1);
}
