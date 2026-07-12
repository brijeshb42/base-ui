import { Type } from 'typebox';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();

// Every path the agent touches is resolved and confined to the repo root, so it can't
// read /proc, $HOME (~/.pi/auth.json, ~/.aws), or anything outside the checkout.
function resolveInside(rel) {
  if (typeof rel !== 'string' || rel.includes('\0')) {
    throw new Error('Invalid path.');
  }
  const abs = path.resolve(ROOT, rel);
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) {
    throw new Error(`Path "${rel}" is outside the repository.`);
  }
  return abs;
}

const under = (abs, dir) => {
  const root = path.resolve(ROOT, dir);
  return abs === root || abs.startsWith(root + path.sep);
};

const text = (t) => ({ content: [{ type: 'text', text: t }], details: {} });

/**
 * The agent's entire capability surface: read-only exploration, writes confined to the
 * configured fix paths, and a single whitelisted test command. No shell, no network.
 * `changedPaths` collects what was written (for logging/sanity).
 */
export function createTools({ fixPaths, testCommand, changedPaths }) {
  const writeRoots = (fixPaths?.length ? fixPaths : ['.']).map((p) => resolveInside(p));

  function assertWritable(rel) {
    const abs = resolveInside(rel);
    if (under(abs, '.github') || under(abs, '.git')) {
      throw new Error('Writing under .github/ or .git/ is not allowed.');
    }
    if (!writeRoots.some((root) => abs === root || abs.startsWith(root + path.sep))) {
      throw new Error(`write_file is restricted to: ${fixPaths.join(', ')}`);
    }
    return abs;
  }

  const tools = [
    {
      name: 'list_dir',
      label: 'List directory',
      description: 'List the entries of a directory inside the repository.',
      parameters: Type.Object({ path: Type.String() }),
      execute: async (_id, { path: p }) => {
        const dirents = await fs.readdir(resolveInside(p), { withFileTypes: true });
        const entries = dirents.map((d) => (d.isDirectory() ? `${d.name}/` : d.name));
        return text(entries.join('\n') || '(empty)');
      },
    },

    {
      name: 'read_file',
      label: 'Read file',
      description: 'Read a UTF-8 file inside the repository (truncated to ~60KB).',
      parameters: Type.Object({ path: Type.String() }),
      execute: async (_id, { path: p }) => {
        const c = await fs.readFile(resolveInside(p), 'utf8');
        return text(c.length > 60000 ? `${c.slice(0, 60000)}\n…[truncated]` : c);
      },
    },

    {
      name: 'search',
      label: 'Search code',
      description:
        'ripgrep for a string/regex across the repo (read-only). Returns up to 80 file:line matches.',
      parameters: Type.Object({ query: Type.String(), path: Type.Optional(Type.String()) }),
      execute: async (_id, { query, path: p }) => {
        const scope = p ? resolveInside(p) : ROOT;
        try {
          const { stdout } = await execFileAsync(
            'rg',
            ['-n', '--max-count', '80', '--', query, scope],
            { maxBuffer: 5_000_000, cwd: ROOT },
          );
          return text(stdout.slice(0, 40000) || '(no matches)');
        } catch (err) {
          if (err.code === 'ENOENT') {
            throw new Error('ripgrep (rg) is not installed on this runner.');
          }
          return text(err.stdout?.slice(0, 40000) || '(no matches)');
        }
      },
    },

    {
      name: 'write_file',
      label: 'Write file',
      description: `Create or overwrite a file (the fix and/or its test). Restricted to: ${fixPaths.join(', ')}.`,
      parameters: Type.Object({ path: Type.String(), content: Type.String() }),
      execute: async (_id, { path: p, content }) => {
        const abs = assertWritable(p);
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, content);
        changedPaths.add(p);
        return text(`Wrote ${p} (${content.length} bytes).`);
      },
    },
  ];

  // Only exposed when the repo configured a test command. Runs a FIXED command with one
  // sanitized pattern argument via execFile (no shell) — never agent-controlled argv.
  if (testCommand?.length) {
    tools.push({
      name: 'run_tests',
      label: 'Run tests',
      description:
        'Run the project test suite for a component/pattern (e.g. "NumberField"). Bounded to 10 minutes.',
      parameters: Type.Object({
        pattern: Type.String({ description: 'Component or test name to filter by.' }),
      }),
      execute: async (_id, { pattern }) => {
        const safe = String(pattern).trim();
        if (!/^[A-Za-z0-9_./-]+$/.test(safe) || safe.startsWith('-')) {
          throw new Error('Invalid pattern: use letters, digits, . / _ - and no leading dash.');
        }
        const [cmd, ...rest] = testCommand;
        const args = rest.includes('{pattern}')
          ? rest.map((a) => (a === '{pattern}' ? safe : a))
          : [...rest, safe];
        try {
          const { stdout } = await execFileAsync(cmd, args, {
            maxBuffer: 10_000_000,
            timeout: 600_000,
            cwd: ROOT,
          });
          return text(stdout.slice(-8000));
        } catch (err) {
          return text(
            `${err.stdout || ''}${err.stderr || ''}`.slice(-8000) || String(err.message || err),
          );
        }
      },
    });
  }

  return tools;
}
