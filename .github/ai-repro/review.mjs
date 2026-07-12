/* eslint-disable no-console */
import { Type } from 'typebox';
import { runAgent, makeUntrustedFence, buildDiscussion } from './harness.mjs';
import { createTools } from './tools.mjs';

// Used when the repo ships no review prompt file — generic but safe defaults.
const DEFAULT_PROMPT = [
  'You are reviewing a pull request in this repository. The PR head is checked out, so',
  'the tools show the changed code in its full context.',
  '- Focus on real problems: bugs, regressions, broken edge cases, unsafe patterns,',
  '  missing or wrong tests. Do not nitpick style that a formatter/linter would catch.',
  '- Read the surrounding code before judging a change; verify claims against the code',
  '  rather than trusting the PR description.',
  '- Only report findings you are confident about, and point to concrete file/line',
  '  locations from the diff.',
].join('\n');

const SEVERITY = Type.Union([
  Type.Literal('critical'),
  Type.Literal('major'),
  Type.Literal('minor'),
  Type.Literal('nit'),
]);

const FINISH_PARAMETERS = Type.Object({
  summary: Type.String({ description: 'Overall assessment of the PR (markdown, concise).' }),
  verdict: Type.Union([
    Type.Literal('looks-good'),
    Type.Literal('needs-changes'),
    Type.Literal('needs-discussion'),
  ]),
  findings: Type.Array(
    Type.Object({
      file: Type.String({ description: 'Repo-relative path.' }),
      line: Type.Optional(Type.Integer({ description: 'Line in the PR head version.' })),
      severity: SEVERITY,
      description: Type.String({ description: 'What is wrong and why it matters (markdown).' }),
      suggestion: Type.Optional(Type.String({ description: 'Suggested fix (markdown).' })),
    }),
  ),
});

const SEVERITY_BADGE = { critical: '🔴', major: '🟠', minor: '🟡', nit: '⚪' };

/**
 * The review task: run a read-only agent over a pre-fetched PR context ({ repo,
 * prNumber, pr: { title, body, baseRef, headRef, author }, diff, comments }) with the
 * PR head checked out. Never talks to GitHub and writes nothing — returns { status:
 * 'review', verdict, findings, comment } for the caller to post.
 */
export async function runReview(inputs) {
  const { context, mention = '@repro-bot', config, providerApiKeys = {} } = inputs;
  const { prNumber, pr, diff, comments = [] } = context;

  const fence = makeUntrustedFence('a GitHub pull request');
  const discussion = buildDiscussion(comments, mention);

  const protocol = [
    '--- Task ---',
    'A maintainer asked you to review this pull request. The PR head is checked out in',
    'the working directory; the diff below shows what changed relative to the base.',
    'Inspect the changed files in context with the tools, run targeted tests where',
    'useful, and judge the change on correctness, regressions, and test coverage.',
    'When done, call the `finish` tool exactly once with your verdict and findings.',
    'Report an empty findings list if the change looks good.',
    '',
    fence.securityNotice,
  ].join('\n');

  const report = [
    fence.open,
    `Pull request #${prNumber}: ${fence.sanitize(pr.title)}`,
    `Base: ${fence.sanitize(pr.baseRef)} ← Head: ${fence.sanitize(pr.headRef)} (author: @${fence.sanitize(pr.author)})`,
    '',
    fence.sanitize(pr.body) || '(no description)',
    diff ? `\n--- Diff ---\n${fence.sanitize(diff)}` : '',
    discussion ? `\n--- Discussion ---\n${fence.sanitize(discussion)}` : '',
    fence.close,
  ].join('\n');

  // Read-only surface: no write_file. run_tests stays available when configured.
  const tools = createTools({ testCommand: config.testCommand, allowWrite: false });

  console.log(`Running review agent on PR #${prNumber}…`);
  const outcome = await runAgent({
    modelSpec: config.model,
    providerApiKeys,
    systemPrompt: [config.prompt || DEFAULT_PROMPT, '', protocol].join('\n'),
    prompt: report,
    tools,
    finish: {
      description: 'Call exactly once with your completed review, then stop.',
      parameters: FINISH_PARAMETERS,
    },
  });

  if (!outcome) {
    return {
      status: 'no-finish',
      comment:
        '🤖 The AI review agent finished without calling `finish`. Check the workflow run artifacts for logs.',
    };
  }

  const findings = outcome.findings || [];
  const findingsSection = findings.length
    ? [
        '',
        `### Findings (${findings.length})`,
        '',
        ...findings.map((f) => {
          const location = f.line ? `\`${f.file}:${f.line}\`` : `\`${f.file}\``;
          const suggestion = f.suggestion ? `\n  - Suggestion: ${f.suggestion}` : '';
          return `- ${SEVERITY_BADGE[f.severity] || ''} **${f.severity}** ${location} — ${f.description}${suggestion}`;
        }),
      ].join('\n')
    : '';

  return {
    status: 'review',
    verdict: outcome.verdict,
    findings,
    comment: [
      `## 🤖 AI code review for #${prNumber}`,
      '',
      `**Verdict:** ${outcome.verdict} · **Model:** \`${config.model}\``,
      '',
      outcome.summary,
      findingsSection,
      '',
      '_Auto-generated — findings may be wrong; verify before acting on them._',
    ].join('\n'),
  };
}
