import path from 'node:path';
import { fileURLToPath } from 'node:url';

import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

const REPO_ROOT = path.dirname(fileURLToPath(import.meta.url));

// Workspace modules, as described in docs/ARCHITECTURE.md section 2.
const APPS = ['extension', 'web', 'api'].map((name) => ({ dir: 'apps', name }));
const PACKAGES = ['contracts', 'provider-core', 'ui', 'config'].map((name) => ({
  dir: 'packages',
  name,
}));
const ALL_MODULES = [...APPS, ...PACKAGES];

const find = (dir, name) => {
  const found = ALL_MODULES.find((m) => m.dir === dir && m.name === name);
  if (!found) throw new Error(`Unknown workspace module ${dir}/${name}`);
  return found;
};

// Relative imports are resolved against the importing file and checked against forbidden
// directories. no-restricted-imports only sees the raw specifier ("../../api/src/x"), so it
// cannot catch these on its own.
const noRestrictedRelativeReach = {
  meta: {
    type: 'problem',
    schema: [{ type: 'array', items: { type: 'string' } }],
    messages: {
      reach:
        'Relative import reaches into "{{dir}}", which this package may not use (docs/ARCHITECTURE.md section 2).',
    },
  },
  create(context) {
    const forbiddenDirs = context.options[0] ?? [];
    const check = (node) => {
      const specifier = node.source?.value;
      if (typeof specifier !== 'string' || !specifier.startsWith('.')) return;
      const target = path
        .relative(REPO_ROOT, path.resolve(path.dirname(context.filename), specifier))
        .split(path.sep)
        .join('/');
      const hit = forbiddenDirs.find((dir) => target === dir || target.startsWith(`${dir}/`));
      if (hit) context.report({ node: node.source, messageId: 'reach', data: { dir: hit } });
    };
    return {
      ImportDeclaration: check,
      ExportNamedDeclaration: check,
      ExportAllDeclaration: check,
      ImportExpression: check,
    };
  },
};

// Builds the rules that block the given modules: by package name (no-restricted-imports)
// and by relative path into their directory (noRestrictedRelativeReach).
function forbid(modules, message) {
  return {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: modules.flatMap(({ name }) => [`@creatorops/${name}`, `@creatorops/${name}/**`]),
            message,
          },
        ],
      },
    ],
    'creatorops/no-restricted-relative-reach': [
      'error',
      modules.map(({ dir, name }) => `${dir}/${name}`),
    ],
  };
}

// Blocks every workspace module except the allowed ones and the owner itself.
function forbidAllExcept(owner, allowedNames, message) {
  const allowed = new Set(allowedNames);
  const modules = ALL_MODULES.filter(
    (m) => !(m.dir === owner.dir && m.name === owner.name) && !allowed.has(m.name),
  );
  return forbid(modules, message);
}

// Adds the restriction on minting WorkspaceId brands to a set of dependency rules.
function withBrandRestriction(rules) {
  const [level, options] = rules['no-restricted-imports'];
  return {
    ...rules,
    'no-restricted-imports': [
      level,
      {
        ...options,
        patterns: [
          ...options.patterns,
          {
            group: ['**/identity/context.js', './context.js'],
            importNames: ['brandWorkspaceId'],
            message:
              'Only the identity service may brand a workspace id, after checking membership (D-025). Use resolveWorkspaceContext.',
          },
        ],
      },
    ],
  };
}

const SOURCE_FILES = '**/*.{ts,tsx,js,jsx,mjs,cjs}';

// Browser globals for the web app and the shared UI package (no `globals` dependency installed).
const BROWSER_GLOBALS = {
  AbortController: 'readonly',
  Headers: 'readonly',
  HTMLElement: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  Request: 'readonly',
  Response: 'readonly',
  clearTimeout: 'readonly',
  console: 'readonly',
  document: 'readonly',
  fetch: 'readonly',
  localStorage: 'readonly',
  navigator: 'readonly',
  sessionStorage: 'readonly',
  setTimeout: 'readonly',
  window: 'readonly',
};

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/dist-e2e/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/.turbo/**',
    ],
  },
  {
    plugins: {
      creatorops: { rules: { 'no-restricted-relative-reach': noRestrictedRelativeReach } },
    },
  },
  js.configs.recommended,
  tseslint.configs.recommended,

  // Dependency rules (docs/ARCHITECTURE.md section 2).
  {
    files: [`apps/web/${SOURCE_FILES}`, `apps/extension/${SOURCE_FILES}`],
    rules: forbid(
      [find('apps', 'api'), find('packages', 'provider-core')],
      'Clients may not import apps/api or provider-core. Provider code and secrets stay server-side.',
    ),
  },
  {
    files: [`apps/api/${SOURCE_FILES}`],
    rules: withBrandRestriction(
      forbid(
        [find('apps', 'web'), find('apps', 'extension'), find('packages', 'ui')],
        'apps/api may not import the web or extension clients or packages/ui.',
      ),
    ),
  },
  // The workspace-id brand may be minted only after a membership check (D-025): by the identity
  // service itself, and by tests that build contexts on purpose.
  {
    files: [
      'apps/api/src/modules/identity/service.ts',
      `apps/api/${'**/*.test.{ts,tsx}'}`,
      'apps/api/src/test/**',
    ],
    rules: forbid(
      [find('apps', 'web'), find('apps', 'extension'), find('packages', 'ui')],
      'apps/api may not import the web or extension clients or packages/ui.',
    ),
  },
  {
    files: [`packages/provider-core/${SOURCE_FILES}`],
    rules: forbidAllExcept(
      find('packages', 'provider-core'),
      ['contracts'],
      'This package may only import @creatorops/contracts from the workspace.',
    ),
  },
  {
    files: [`packages/ui/${SOURCE_FILES}`],
    rules: forbidAllExcept(
      find('packages', 'ui'),
      ['contracts'],
      'This package may only import @creatorops/contracts from the workspace.',
    ),
  },
  {
    files: [`packages/contracts/${SOURCE_FILES}`],
    rules: forbidAllExcept(
      find('packages', 'contracts'),
      [],
      'packages/contracts may not import any other workspace module.',
    ),
  },

  // Browser front ends: .tsx components need JSX parsing, and their code runs in a browser.
  {
    files: [`apps/web/${SOURCE_FILES}`, `packages/ui/${SOURCE_FILES}`],
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: BROWSER_GLOBALS,
    },
  },
  // The extension is a browser app too, and also has the `chrome` extension API.
  {
    files: [`apps/extension/${SOURCE_FILES}`],
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...BROWSER_GLOBALS, chrome: 'readonly' },
    },
  },

  // Build, test and tooling configuration files run in Node.
  {
    files: [
      '**/vite.config.ts',
      '**/vitest.config.ts',
      '**/playwright.config.ts',
      '**/drizzle.config.ts',
      '**/e2e/**/*.ts',
      '**/scripts/**/*.mjs',
    ],
    languageOptions: { globals: { process: 'readonly', console: 'readonly' } },
  },

  // Keep last: turns off formatting rules that Prettier owns.
  prettier,
);
