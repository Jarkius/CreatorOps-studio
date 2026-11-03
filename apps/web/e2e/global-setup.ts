import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(here, '..');
const seedCli = path.resolve(webDir, '..', 'api', 'dist', 'db', 'cli.js');

/** Seeds the development user so the Overview has a signed-in account to show. */
export default function globalSetup(): void {
  execFileSync(process.execPath, [seedCli, 'seed'], {
    cwd: webDir,
    env: process.env,
    stdio: 'inherit',
  });
}
