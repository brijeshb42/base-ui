import fs from 'node:fs/promises';

const CONFIG_PATH = process.env.AI_REPRO_CONFIG || '.github/ai-repro.config.json';
const DEFAULT_PROMPT_FILE = '.github/ai-repro.prompt.md';

function parseList(value) {
  return value ? value.split(/[,\s]+/).filter(Boolean) : null;
}

async function readIfExists(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

/**
 * Resolve the repo-specific configuration. Everything the agent needs to know about a
 * particular repo lives in the prompt file + an optional JSON config, so the harness
 * itself stays generic. Env vars override the config file for CI convenience.
 */
export async function loadConfig() {
  const rawConfig = await readIfExists(CONFIG_PATH);
  const file = rawConfig ? JSON.parse(rawConfig) : {};

  const promptFile = process.env.AI_REPRO_PROMPT_FILE || file.promptFile || DEFAULT_PROMPT_FILE;
  const prompt = await readIfExists(promptFile);
  if (prompt === null) {
    throw new Error(
      `AI repro prompt file not found at "${promptFile}". ` +
        `Create it with repo-specific instructions, or set "promptFile" in ${CONFIG_PATH} / the AI_REPRO_PROMPT_FILE env var.`,
    );
  }

  return {
    // Repo-specific instructions handed to the agent as the first part of the prompt.
    prompt: prompt.trim(),
    promptFile,
    // provider:model-id passed to pi's ModelRegistry.find().
    model: process.env.AI_REPRO_MODEL || file.model || 'anthropic:claude-opus-4-5',
    // npm package name. When set, enables "library mode": before/after StackBlitz
    // sandboxes powered by pkg.pr.new. Leave unset for non-library repos.
    packageName: process.env.AI_REPRO_PACKAGE || file.package || null,
    // Version used for the "before" (buggy) sandbox.
    releasedVersion: process.env.AI_REPRO_RELEASED_VERSION || file.releasedVersion || 'latest',
    // PR base branch. Null => gh uses the repo's default branch.
    baseBranch: process.env.AI_REPRO_BASE_BRANCH || file.baseBranch || null,
    // Paths to stage as "the fix" and the only paths the agent may write. Defaults to
    // the whole tree (lockfiles are reset out) — set it narrowly for tighter isolation.
    fixPaths: parseList(process.env.AI_REPRO_FIX_PATHS) || file.fixPaths || ['.'],
    // Fixed argv for the run_tests tool; a "{pattern}" element is replaced with the
    // agent's sanitized pattern (else it's appended). Null => run_tests is not offered.
    testCommand: parseList(process.env.AI_REPRO_TEST_COMMAND) || file.testCommand || null,
  };
}
