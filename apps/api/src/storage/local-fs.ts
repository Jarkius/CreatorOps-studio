import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, realpath, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { assertValidKey, type ReadOptions, type Storage, type StoredObject } from './storage.js';

/**
 * Stores objects under one root directory. Defences against escaping it:
 * - keys are validated (no `..`, no absolute paths, a strict character set);
 * - the resolved path must stay inside the root;
 * - the parent directory's real path (after symlinks) must stay inside the root's real path.
 */
export class LocalFsStorage implements Storage {
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private resolve(key: string): string {
    assertValidKey(key);
    const full = path.resolve(this.root, ...key.split('/'));
    if (full !== this.root && !full.startsWith(this.root + path.sep)) {
      throw new Error('Invalid storage key');
    }
    return full;
  }

  /** Throws if the directory that holds `full` resolves (through symlinks) outside the root. */
  private async assertInsideRoot(full: string): Promise<void> {
    await mkdir(this.root, { recursive: true });
    const realRoot = await realpath(this.root);
    const realParent = await realpath(path.dirname(full));
    if (realParent !== realRoot && !realParent.startsWith(realRoot + path.sep)) {
      throw new Error('Invalid storage key');
    }
  }

  async put(key: string, source: Readable): Promise<StoredObject> {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await this.assertInsideRoot(full);
    try {
      // "wx": never overwrite, and never follow a pre-existing symlink at the target.
      await pipeline(source, createWriteStream(full, { flags: 'wx', mode: 0o600 }));
    } catch (error) {
      // Remove the partial file this call created, but never a pre-existing object: EEXIST means
      // the target belonged to someone else and must be left untouched.
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') await rm(full, { force: true });
      throw error;
    }
    return { size: (await stat(full)).size };
  }

  async read(key: string, options: ReadOptions = {}): Promise<Readable> {
    const full = this.resolve(key);
    await this.assertInsideRoot(full);
    await stat(full);
    return createReadStream(full, {
      ...(options.start === undefined ? {} : { start: options.start }),
      ...(options.end === undefined ? {} : { end: options.end }),
    });
  }

  async stat(key: string): Promise<StoredObject | null> {
    const full = this.resolve(key);
    try {
      await this.assertInsideRoot(full);
      const info = await stat(full);
      return info.isFile() ? { size: info.size } : null;
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    const full = this.resolve(key);
    try {
      await this.assertInsideRoot(full);
    } catch {
      return;
    }
    await rm(full, { force: true });
  }
}
