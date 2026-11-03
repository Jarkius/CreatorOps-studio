import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LocalFsStorage } from './local-fs.js';
import { assertValidKey } from './storage.js';

let root: string;
let outside: string;
let storage: LocalFsStorage;

beforeEach(async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'creatorops-storage-'));
  root = path.join(base, 'root');
  outside = path.join(base, 'outside');
  await mkdir(outside, { recursive: true });
  storage = new LocalFsStorage(root);
});

afterEach(async () => {
  await rm(path.dirname(root), { recursive: true, force: true });
});

const bytes = (text: string) => Readable.from([Buffer.from(text)]);
async function readAll(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks).toString('utf8');
}

describe('LocalFsStorage', () => {
  it('stores, reads, stats and deletes an object', async () => {
    const key = 'ws/abc/asset1/original.png';
    expect(await storage.put(key, bytes('hello'))).toEqual({ size: 5 });
    expect(await storage.stat(key)).toEqual({ size: 5 });
    expect(await readAll(await storage.read(key))).toBe('hello');
    await storage.delete(key);
    expect(await storage.stat(key)).toBeNull();
    await storage.delete(key); // deleting again is fine
  });

  it('reads a byte range, inclusive at both ends', async () => {
    await storage.put('a/b.bin', bytes('0123456789'));
    expect(await readAll(await storage.read('a/b.bin', { start: 2, end: 5 }))).toBe('2345');
    expect(await readAll(await storage.read('a/b.bin', { start: 7 }))).toBe('789');
  });

  it('never overwrites an existing object', async () => {
    await storage.put('a/b.bin', bytes('first'));
    await expect(storage.put('a/b.bin', bytes('second'))).rejects.toThrow();
    expect(await readAll(await storage.read('a/b.bin'))).toBe('first');
  });

  it('removes a partial file when the source stream fails', async () => {
    const failing = new Readable({
      read() {
        this.push(Buffer.from('partial'));
        this.destroy(new Error('connection lost'));
      },
    });
    await expect(storage.put('a/partial.bin', failing)).rejects.toThrow();
    expect(await storage.stat('a/partial.bin')).toBeNull();
  });

  it('files are private to the owner (mode 0600)', async () => {
    await storage.put('a/private.bin', bytes('x'));
    const { stat } = await import('node:fs/promises');
    const mode = (await stat(path.join(root, 'a', 'private.bin'))).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('rejects keys that could escape the root or are not server-shaped', async () => {
    for (const key of [
      '../x',
      'a/../../x',
      '/etc/passwd',
      'a//b',
      'a/./b',
      '',
      'A/b',
      'a b',
      'a\\b',
      'a/b\0c',
      '.hidden',
      'x'.repeat(301),
      'a/b?x',
      'ก/b',
    ]) {
      expect(() => assertValidKey(key), JSON.stringify(key)).toThrow('Invalid storage key');
      await expect(storage.put(key, bytes('x')), JSON.stringify(key)).rejects.toThrow(
        'Invalid storage key',
      );
      await expect(storage.read(key), JSON.stringify(key)).rejects.toThrow('Invalid storage key');
      await expect(storage.stat(key), JSON.stringify(key)).rejects.toThrow('Invalid storage key');
    }
    expect(await readFile(path.join(outside, 'x'), 'utf8').catch(() => 'absent')).toBe('absent');
  });

  it('refuses to write or read through a symlink that points outside the root', async () => {
    await mkdir(root, { recursive: true });
    await symlink(outside, path.join(root, 'escape'));
    await expect(storage.put('escape/stolen.bin', bytes('x'))).rejects.toThrow(
      'Invalid storage key',
    );
    await writeFile(path.join(outside, 'secret.txt'), 'secret');
    await expect(storage.read('escape/secret.txt')).rejects.toThrow('Invalid storage key');
    expect(await storage.stat('escape/secret.txt')).toBeNull();
    await storage.delete('escape/secret.txt');
    expect(await readFile(path.join(outside, 'secret.txt'), 'utf8')).toBe('secret');
    expect(await readFile(path.join(outside, 'stolen.bin'), 'utf8').catch(() => 'absent')).toBe(
      'absent',
    );
  });

  it('does not follow a symlink planted at the target file', async () => {
    await mkdir(path.join(root, 'a'), { recursive: true });
    await writeFile(path.join(outside, 'target.txt'), 'original');
    await symlink(path.join(outside, 'target.txt'), path.join(root, 'a', 'link.bin'));
    await expect(storage.put('a/link.bin', bytes('overwritten'))).rejects.toThrow();
    expect(await readFile(path.join(outside, 'target.txt'), 'utf8')).toBe('original');
  });

  it('answers null for an object that does not exist, and rejects reading it', async () => {
    expect(await storage.stat('a/missing.bin')).toBeNull();
    await expect(storage.read('a/missing.bin')).rejects.toThrow();
  });
});
