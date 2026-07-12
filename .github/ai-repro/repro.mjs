/* eslint-disable no-console */
import { Type } from 'typebox';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runAgent, makeUntrustedFence, buildDiscussion } from './harness.mjs';
import { createTools } from './tools.mjs';
import { writeReproApp, stackblitzUrl } from './repro-template.mjs';

const execFileAsync = promisify(execFile);

async function git(args) {
  const { stdout } = await execFileAsync('git', args, { maxBuffer: 20_000_000 });
  return stdout;
}

function finishParameters(wantsAppTsx) {
  return Type.Object({
    canReproduce: Type.Boolean({
      description: 'Whether you could construct a minimal reproduction from the report.',
    }),
    component: Type.String({ description: 'Primary area/component touched.' }),
    confidence: Type.Union([Type.Literal('low'), Type.Literal('medium'), Type.Literal('high')]),
    rootCause: Type.String({ description: 'Concise root-cause analysis (markdown).' }),
    fixSummary: Type.String({ description: 'What the fix changes and why (markdown).' }),
    reproTitle: Type.String(),
    reproDescription: Type.String({
      description: 'What the tester should observe / steps to see the bug (markdown).',
    }),
    appTsx: Type.Optional(
      Type.String({
        description: wantsAppTsx
          ? 'Full contents of src/App.tsx: a self-contained default-export React component that reproduces the bug using the library. No external CSS.'
          : 'Unused for this repo — leave empty.',
      }),
    ),
  });
}

/**
 * Trusted instructions (repo prompt + harness protocol) go in the system prompt; the
 * untrusted, fenced issue report is the user message. Returns { systemPrompt, report }.
 */
function buildPrompt({ config, issueNumber, issue, discussion, libraryMode, fence }) {
  // Generic protocol (harness-owned) appended after the repo's own instructions.
  const protocol = [
    '--- Task ---',
    'A maintainer asked you to reproduce the reported issue and, if confident, write a minimal fix.',
    libraryMode
      ? `Also provide the full contents of a self-contained src/App.tsx (default-export React component) that reproduces the bug using the "${config.packageName}" package, in the finish tool's appTsx field. No external CSS.`
      : '',
    'Do not commit, push, or open PRs — that is handled for you after you call finish.',
    'When done, call the `finish` tool exactly once. If you cannot reproduce it, set canReproduce=false and explain why in rootCause.',
    '',
    fence.securityNotice,
  ]
    .filter(Boolean)
    .join('\n');

  const report = [
    fence.open,
    `Issue #${issueNumber}: ${fence.sanitize(issue.title)}`,
    '',
    fence.sanitize(issue.body) || '(no description)',
    discussion ? `\n--- Discussion ---\n${fence.sanitize(discussion)}` : '',
    fence.close,
  ].join('\n');

  return {
    systemPrompt: [config.prompt, '', protocol].join('\n'),
    report,
  };
}

/**
 * The repro task: run the agent on a pre-fetched issue context and commit the result
 * locally. It never talks to GitHub — the caller pre-fetches `context` ({ repo,
 * issueNumber, issue: { title, body }, comments: [{ user, body }] }) and handles push /
 * PR creation / commenting afterwards. Returns { status, comment?, prTitle?, prBody?,
 * branch?, ... }; `comment` and the canary template may contain {{PR_URL}} /
 * {{PR_NUMBER}} placeholders for the caller to substitute once the PR exists.
 */
export async function runRepro(inputs) {
  const { context, mention = '@repro-bot', config, providerApiKeys = {} } = inputs;
  const { repo, issueNumber, issue, comments = [] } = context;
  // No slashes: StackBlitz github URLs can't disambiguate branch segments from path segments.
  const branch = `ai-repro-issue-${issueNumber}`;
  const reproRoot = `repros/issue-${issueNumber}`;

  const fence = makeUntrustedFence('a GitHub issue');
  const discussion = buildDiscussion(comments, mention);
  const wantsAppTsx = Boolean(config.packageName);
  const { systemPrompt, report } = buildPrompt({
    config,
    issueNumber,
    issue,
    discussion,
    libraryMode: wantsAppTsx,
    fence,
  });

  const changedPaths = new Set();
  const tools = createTools({
    fixPaths: config.fixPaths,
    testCommand: config.testCommand,
    changedPaths,
  });

  console.log(`Running repro agent on issue #${issueNumber}…`);
  const outcome = await runAgent({
    modelSpec: config.model,
    providerApiKeys,
    systemPrompt,
    prompt: report,
    tools,
    finish: {
      description: 'Call exactly once when done to report the reproduction and fix, then stop.',
      parameters: finishParameters(wantsAppTsx),
    },
  });

  if (!outcome) {
    return {
      status: 'no-finish',
      comment:
        '🤖 The AI repro agent finished without calling `finish`. Check the workflow run artifacts for logs.',
    };
  }

  if (!outcome.canReproduce) {
    return {
      status: 'no-repro',
      comment: `## 🤖 AI repro: could not reproduce\n\n${outcome.rootCause}\n\n_Model: \`${config.model}\` · confidence: ${outcome.confidence}_`,
    };
  }

  const libraryMode = wantsAppTsx && Boolean(outcome.appTsx);
  if (libraryMode) {
    await Promise.all([
      writeReproApp(`${reproRoot}/before`, {
        appTsx: outcome.appTsx,
        packageName: config.packageName,
        dependency: config.releasedVersion,
      }),
      writeReproApp(`${reproRoot}/after`, {
        appTsx: outcome.appTsx,
        packageName: config.packageName,
        dependency: 'CANARY_PLACEHOLDER',
      }),
    ]);
  }

  await git(['config', 'user.name', 'github-actions[bot]']);
  await git(['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
  await git(['checkout', '-B', branch]);
  await git(['add', ...config.fixPaths, ...(libraryMode ? [reproRoot] : [])]);
  // Never commit dependency lockfiles that `install` may have touched.
  try {
    await git(['reset', '--', 'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock']);
  } catch {
    // no lockfile staged
  }

  const staged = (await git(['diff', '--cached', '--name-only']))
    .trim()
    .split('\n')
    .filter(Boolean);
  if (staged.length === 0) {
    return {
      status: 'analysis-only',
      comment: `## 🤖 AI repro analysis for #${issueNumber}\n\n${outcome.rootCause}\n\n${outcome.fixSummary}\n\n_No code changes were produced. Model: \`${config.model}\`._`,
    };
  }
  const hasFix = staged.some((p) => !p.startsWith(`${reproRoot}/`));

  await git([
    'commit',
    '-m',
    `[repro] AI reproduction${hasFix ? ' and fix' : ''} for #${issueNumber}`,
  ]);
  // Non-compact URL (owner/repo included) — the repo publishes with `--compact false`.
  // The PR doesn't exist yet; the caller substitutes {{PR_NUMBER}} after creating it.
  const canaryUrl = libraryMode
    ? `https://pkg.pr.new/${repo}/${config.packageName}@{{PR_NUMBER}}`
    : null;
  const liveSection = libraryMode
    ? buildLiveSection({ repo, branch, reproRoot, config, outcome, canaryUrl })
    : '';

  return {
    status: hasFix ? 'fix-pr' : 'repro-pr',
    branch,
    reproRoot,
    hasFix,
    libraryMode,
    baseBranch: config.baseBranch,
    prTitle: `[repro] ${outcome.reproTitle} (fixes #${issueNumber})`,
    prBody: buildPrBody({ config, issueNumber }, outcome, hasFix),
    // The caller pins the canary into this file once the PR number is known.
    canaryUrl,
    afterPackageJson: libraryMode ? `${reproRoot}/after/package.json` : null,
    comment: [
      `## 🤖 AI reproduction & proposed fix for #${issueNumber}`,
      '',
      `**Area:** ${outcome.component} · **Confidence:** ${outcome.confidence} · **Model:** \`${config.model}\``,
      '',
      '### Root cause',
      outcome.rootCause,
      '',
      hasFix ? '### Proposed fix' : '### Analysis',
      outcome.fixSummary,
      liveSection,
      `📝 Draft PR: {{PR_URL}}`,
      '',
      '_Auto-generated — review the diff before trusting the fix._',
    ].join('\n'),
  };
}

function buildLiveSection({ repo, branch, reproRoot, config, outcome, canaryUrl }) {
  const beforeLink = stackblitzUrl({ repo, branch, subdir: `${reproRoot}/before` });
  const afterLink = stackblitzUrl({ repo, branch, subdir: `${reproRoot}/after` });

  return [
    '',
    '### Try it live',
    '| | Version | Sandbox |',
    '| --- | --- | --- |',
    `| 🐞 Before (bug) | \`${config.releasedVersion}\` | [Open in StackBlitz](${beforeLink}) |`,
    `| ✅ After (fix) | canary of this PR | [Open in StackBlitz](${afterLink}) |`,
    '',
    `> The **After** sandbox installs \`${canaryUrl}\`, available once the draft PR's CI publishes the canary (a few minutes). ${outcome.reproDescription}`,
    '',
  ].join('\n');
}

function buildPrBody(ctx, outcome, hasFix) {
  return [
    `Auto-generated draft reproducing and ${hasFix ? 'fixing' : 'analyzing'} #${ctx.issueNumber}.`,
    '',
    '## Root cause',
    outcome.rootCause,
    '',
    hasFix ? '## Fix' : '## Analysis',
    outcome.fixSummary,
    '',
    '## Reproduction',
    outcome.reproDescription,
    '',
    `> Generated by \`${ctx.config.model}\` (confidence: ${outcome.confidence}). **Do not merge without human review.**`,
  ].join('\n');
}
