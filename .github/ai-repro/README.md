# AI Repro & Fix agent

A repo-agnostic slash-command agent that reproduces a reported bug, attempts a fix, opens
a draft PR, and (for libraries) posts before/after live sandboxes for devs to test.

Built on the [pi](https://github.com/earendil-works/pi) coding-agent SDK
(`@earendil-works/pi-coding-agent` + `@earendil-works/pi-ai`), which provides the agent
loop and multi-provider model resolution. We deliberately do **not** enable pi's built-in
`bash`/`read`/`write`/`edit` or any web/fetch tool — the agent gets only a narrow,
repo-scoped allowlist of custom tools (see [Safety](#safety--prompt-injection)).

## How it works

1. A maintainer **mentions the bot** on a bug **issue** (e.g. `@repro-bot please repro`).
2. `.github/workflows/ai-repro.yml` gates on the mention + author association and runs
   `cli.mjs`, which loads the repo's config + prompt file.
3. The agent explores the repo (read/search), reproduces the bug, and — when confident —
   writes a minimal fix (running tests via `run_tests` to check it).
4. It commits to `ai-repro-issue-<n>` and opens a **draft PR**.
5. **Library mode** (a `package` is configured): it also generates two standalone Vite
   apps under `repros/issue-<n>/{before,after}` and, once the PR's CI publishes a
   [pkg.pr.new](https://pkg.pr.new) canary, comments **StackBlitz** links — `before`
   pinned to the last release, `after` to the canary.
6. The agent comments on the issue with root cause, fix summary, the draft PR link, and
   (library mode) the sandbox links.

StackBlitz opens each folder straight from the branch
(`stackblitz.com/github/<repo>/tree/<branch>/repros/issue-<n>/after`), so no StackBlitz
account/token is needed. The **after** sandbox only installs once the PR's canary
finishes publishing (a few minutes).

## Reusing in another repo

Copy `.github/ai-repro/`, `.github/workflows/ai-repro.yml`, and add two repo-owned files:

**`.github/ai-repro.prompt.md`** — repo-specific instructions handed to the agent (where
source lives, how to run tests, conventions, which paths it may edit). This is the "maybe
from a file path" prompt — swap it per repo, no code changes.

**`.github/ai-repro.config.json`** — repo settings:

```json
{
  "promptFile": ".github/ai-repro.prompt.md",
  "package": "@base-ui/react", // optional: enables library mode + StackBlitz sandboxes
  "baseBranch": "master", // optional: defaults to the repo's default branch
  "releasedVersion": "latest", // optional: version for the "before" sandbox
  "fixPaths": ["packages"] // optional: paths staged as the fix (default ["."])
}
```

Omit `package` for a non-library repo — it then just opens a fix PR and comments the
analysis (no sandboxes). Each field can also be overridden by an env var
(`AI_REPRO_PROMPT_FILE`, `AI_REPRO_PACKAGE`, `AI_REPRO_BASE_BRANCH`,
`AI_REPRO_RELEASED_VERSION`, `AI_REPRO_FIX_PATHS`, `AI_REPRO_MODEL`); the config path
itself is `AI_REPRO_CONFIG` (default `.github/ai-repro.config.json`).

## Secrets & variables

Repo **Settings → Secrets and variables → Actions**:

| Kind     | Name                           | Purpose                                                                                                                                                                                                                              |
| :------- | :----------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Secret   | `ANTHROPIC_API_KEY`            | Required for an `anthropic:` model (default).                                                                                                                                                                                        |
| Secret   | `OPENAI_API_KEY`               | Required for an `openai:` model.                                                                                                                                                                                                     |
| Secret   | `GOOGLE_GENERATIVE_AI_API_KEY` | Required for a `google:` model.                                                                                                                                                                                                      |
| Secret   | `AI_REPRO_TOKEN`               | **Recommended** PAT (repo scope). Without it the draft PR is created by the default token, which does **not** trigger CI — so the pkg.pr.new canary never builds and the "after" sandbox stays broken. Falls back to `github.token`. |
| Variable | `AI_REPRO_MODEL`               | `provider:model-id` override, e.g. `openai:gpt-5`. Defaults to config / `anthropic:claude-opus-4-5`.                                                                                                                                 |
| Variable | `AI_REPRO_MENTION`             | The string that triggers the workflow, e.g. `@repro-bot`. Defaults to `@repro-bot`.                                                                                                                                                  |

Model resolution goes through pi's `ModelRegistry.find(provider, id)`. Add a provider by
extending `PROVIDER_KEY_ENV` in `cli.mjs` and wiring its key secret.

## Triggering & the bot handle

The workflow fires on **any** `issue_comment` and gates on
`contains(comment.body, AI_REPRO_MENTION)`. So "tagging the bot" is just putting that string
in a comment — the mention does **not** have to be a real account for detection to work
(same as `@dependabot rebase`). Set `AI_REPRO_MENTION` to whatever you want (`@repro-bot`,
`/repro`, `@acme-ai`).

For a polished bot — an `@handle` that **autocompletes with an avatar** and shows the draft
PR/comments as authored **by the bot** — give it a real identity:

- **GitHub App (recommended):** create an App (Issues + PRs + Contents: write), install it on
  the repo, mint an installation token in the workflow (e.g. `actions/create-github-app-token`)
  and pass it as `AI_REPRO_TOKEN`. Set `AI_REPRO_MENTION` to the App's `@slug`. PR/comments
  then show as `slug[bot]`.
- **Machine user:** a dedicated GitHub account added as a collaborator; use its PAT as
  `AI_REPRO_TOKEN` and its handle as `AI_REPRO_MENTION`.

Either way, keep the **author-association gate** (`OWNER`/`MEMBER`/`COLLABORATOR`) so only
trusted people can invoke the agent on untrusted issue text. The mention identifies _what_ to
run; the association controls _who_ may run it. (Commit author is separately set to
`github-actions[bot]` in `index.mjs` — change it there if you want commits attributed to the
bot too.)

## Files

- `cli.mjs` — entry point: assembles all inputs from the environment (tokens, issue, config),
  scrubs secrets, calls the library, and posts the resulting comment.
- `config.mjs` — loads the prompt + JSON config (env overrides).
- `tools.mjs` — the agent's entire capability surface (repo-scoped, no shell/network).
- `index.mjs` — env-free library: `runRepro(inputs)` runs the whole flow (agent session,
  commit/push, draft PR) and returns `{ status, comment, prUrl }`.
- `repro-template.mjs` — Vite/React repro scaffold + StackBlitz URL builder (library mode).

This package is intentionally outside the pnpm workspace (installed with `npm` at CI
time) so its dependencies never enter the lockfile.

## Safety & prompt injection

The issue title/body/comments are **untrusted** — the person who runs `/repro` is trusted,
but the issue author may not be. Since the agent has tools, a malicious report could try to
hijack it. Defenses, in order of importance:

1. **No shell, no network, explicit tools only.** pi's built-in `bash`/`read`/`write`/
   `edit` and any web/fetch tool are disabled. The agent gets a fixed allowlist (`tools.mjs`):
   - `list_dir`, `read_file`, `search` (ripgrep) — read-only, **confined to the repo root**
     (`/etc`, `$HOME`, `~/.pi/auth.json`, `/proc/*`, and `..` traversal are all rejected).
   - `write_file` — restricted to the configured `fixPaths`, and always denies `.github/`
     and `.git/` (so it can't plant a malicious workflow or rewrite VCS config).
   - `run_tests` — runs a **fixed** command from config with one regex-sanitized `pattern`
     arg via `execFile` (no shell); the agent never controls the argv or flags.
   - `finish` — structured output only.
2. **Secrets are removed from the agent's environment.** `cli.mjs` captures the model keys
   and tokens into the library's inputs, then deletes them (plus Actions OIDC tokens) from
   `process.env` before the library runs (the model key lives in pi's in-memory auth, not env).
3. **The write PAT never touches disk.** Checkout uses `persist-credentials: false`; the
   script pushes with a just-in-time authenticated URL after the agent has finished.
4. **The report is fenced and labeled untrusted.** `buildPrompt` wraps it in
   `<<<UNTRUSTED_REPORT>>>` markers, strips those markers from the content so it can't forge
   the boundary, and instructs the model to treat it as data only.
5. **Trigger gating + limited persistence.** Only `OWNER`/`MEMBER`/`COLLABORATOR` can invoke;
   only `fixPaths` + generated `repros/` are committed (lockfiles reset out); the PR is always
   a **draft**.

**Residual risk:** the one code-execution surface left is `run_tests` — the agent can write
a fix/test file under `fixPaths` and run the test suite, which executes that code. That's
inherent to verifying a fix. Its blast radius is bounded (ephemeral runner, secrets scrubbed
from `process.env`, no PAT on disk), but a test executed this way could still read the
**ancestor** step shell's env via `/proc/<pid>/environ`. For full isolation, run the agent
step in a network-restricted container whose environment carries no secrets (or drop
`run_tests` and have the harness run tests after `finish`). Keep the PAT's scope minimal.
