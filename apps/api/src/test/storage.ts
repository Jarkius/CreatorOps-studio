import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { LocalFsStorage } from '../storage/local-fs.js';

const roots: string[] = [];

/** A storage adapter backed by a throwaway directory that is removed when the process exits. */
export function testStorage(): LocalFsStorage {
  const root = mkdtempSync(path.join(os.tmpdir(), 'creatorops-test-media-'));
  roots.push(root);
  return new LocalFsStorage(root);
}

process.on('exit', () => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});
