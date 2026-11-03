import { ESLint } from 'eslint';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Lints snippets with the real repo ESLint config, so these tests prove the dependency rules
// in eslint.config.js actually fire (docs/ARCHITECTURE.md section 2, docs/08 S0.1).
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const eslint = new ESLint({ cwd: repoRoot });

// Package-name imports are reported by no-restricted-imports; relative reach by the repo's
// creatorops/no-restricted-relative-reach rule. Both count as a dependency-rule violation.
const RESTRICTION_RULES = ['no-restricted-imports', 'creatorops/no-restricted-relative-reach'];

async function restrictedImportMessages(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? [])
    .filter((message) => message.ruleId !== null && RESTRICTION_RULES.includes(message.ruleId))
    .map((message) => message.message);
}

describe('dependency rules', () => {
  it('blocks apps/web from importing @creatorops/provider-core', async () => {
    const errors = await restrictedImportMessages(
      "import { x } from '@creatorops/provider-core';\nexport const y = x;\n",
      'apps/web/src/x.ts',
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it('allows apps/web to import @creatorops/contracts', async () => {
    const errors = await restrictedImportMessages(
      "import { PACKAGE_NAME } from '@creatorops/contracts';\nexport const y = PACKAGE_NAME;\n",
      'apps/web/src/x.ts',
    );
    expect(errors).toEqual([]);
  });

  it('blocks apps/web from reaching into apps/api by relative path', async () => {
    const errors = await restrictedImportMessages(
      "import { APP_NAME } from '../../api/src/index.js';\nexport const y = APP_NAME;\n",
      'apps/web/src/x.ts',
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it('blocks apps/api from importing @creatorops/ui', async () => {
    const errors = await restrictedImportMessages(
      "import { PACKAGE_NAME } from '@creatorops/ui';\nexport const y = PACKAGE_NAME;\n",
      'apps/api/src/x.ts',
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it('blocks packages/contracts from importing @creatorops/ui', async () => {
    const errors = await restrictedImportMessages(
      "import { PACKAGE_NAME } from '@creatorops/ui';\nexport const y = PACKAGE_NAME;\n",
      'packages/contracts/src/x.ts',
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it('blocks packages/ui from importing @creatorops/provider-core', async () => {
    const errors = await restrictedImportMessages(
      "import { PACKAGE_NAME } from '@creatorops/provider-core';\nexport const y = PACKAGE_NAME;\n",
      'packages/ui/src/x.ts',
    );
    expect(errors.length).toBeGreaterThan(0);
  });
});
