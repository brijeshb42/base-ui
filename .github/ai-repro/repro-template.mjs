import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Write a self-contained Vite + React + TS app that renders the agent's repro.
 * `dependency` is whatever gets pinned for `packageName` (a released version for the
 * "before" variant, the pkg.pr.new canary URL for the "after" variant).
 */
export async function writeReproApp(dir, { appTsx, dependency, packageName }) {
  const files = {
    'package.json': `${JSON.stringify(
      {
        name: 'repro-app',
        private: true,
        type: 'module',
        scripts: { dev: 'vite', build: 'vite build' },
        dependencies: {
          [packageName]: dependency,
          react: 'latest',
          'react-dom': 'latest',
        },
        devDependencies: {
          '@types/react': 'latest',
          '@types/react-dom': 'latest',
          '@vitejs/plugin-react': 'latest',
          typescript: 'latest',
          vite: 'latest',
        },
      },
      null,
      2,
    )}\n`,
    'vite.config.ts': `import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\n\nexport default defineConfig({ plugins: [react()] });\n`,
    'tsconfig.json': `${JSON.stringify(
      {
        compilerOptions: {
          target: 'ESNext',
          lib: ['DOM', 'DOM.Iterable', 'ESNext'],
          module: 'ESNext',
          moduleResolution: 'bundler',
          jsx: 'react-jsx',
          strict: true,
          skipLibCheck: true,
          esModuleInterop: true,
        },
        include: ['src'],
      },
      null,
      2,
    )}\n`,
    'index.html': `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <title>Base UI repro</title>\n  </head>\n  <body>\n    <div id="root"></div>\n    <script type="module" src="/src/main.tsx"></script>\n  </body>\n</html>\n`,
    'src/main.tsx': `import React from 'react';\nimport { createRoot } from 'react-dom/client';\nimport App from './App';\n\ncreateRoot(document.getElementById('root')!).render(\n  <React.StrictMode>\n    <App />\n  </React.StrictMode>,\n);\n`,
    'src/App.tsx': appTsx.endsWith('\n') ? appTsx : `${appTsx}\n`,
  };

  await Promise.all(
    Object.entries(files).map(async ([rel, content]) => {
      const abs = path.join(dir, rel);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, content);
    }),
  );
}

/** StackBlitz opens any folder of a public GitHub branch, running its dev script. */
export function stackblitzUrl({ repo, branch, subdir }) {
  return `https://stackblitz.com/github/${repo}/tree/${branch}/${subdir}?file=src/App.tsx`;
}
