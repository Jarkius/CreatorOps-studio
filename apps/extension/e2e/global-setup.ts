import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const extensionDir = path.resolve(here, '..');
const seedCli = path.resolve(extensionDir, '..', 'api', 'dist', 'db', 'cli.js');

/** Seeds the development user so the side panel has a signed-in account to show. */
export default function globalSetup(): void {
  execFileSync(process.execPath, [seedCli, 'seed'], {
    cwd: extensionDir,
    env: process.env,
    stdio: 'inherit',
  });
}
