import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { ZipError, buildZip, zipChunks, type ZipEntry } from './zip.js';

const FIXED = new Date(Date.UTC(2026, 10, 4, 12, 30, 10));

interface Parsed {
  name: string;
  data: Buffer;
  crc: number;
  method: number;
}

/** Independent reader: walks the central directory, then reads each entry through its local header. */
function readZip(zip: Buffer): Parsed[] {
  const eocd = zip.length - 22;
  expect(zip.readUInt32LE(eocd)).toBe(0x06054b50);
  const count = zip.readUInt16LE(eocd + 10);
  const centralSize = zip.readUInt32LE(eocd + 12);
  const centralOffset = zip.readUInt32LE(eocd + 16);
  expect(centralOffset + centralSize).toBe(eocd);
  const out: Parsed[] = [];
  let at = centralOffset;
  for (let i = 0; i < count; i += 1) {
    expect(zip.readUInt32LE(at)).toBe(0x02014b50);
    const method = zip.readUInt16LE(at + 10);
    const crc = zip.readUInt32LE(at + 16);
    const size = zip.readUInt32LE(at + 24);
    const nameLength = zip.readUInt16LE(at + 28);
    const offset = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString('ascii');
    expect(zip.readUInt32LE(offset)).toBe(0x04034b50);
    const localName = zip.readUInt16LE(offset + 26);
    const localExtra = zip.readUInt16LE(offset + 28);
    const start = offset + 30 + localName + localExtra;
    out.push({ name, data: zip.subarray(start, start + size), crc, method });
    at += 46 + nameLength;
  }
  return out;
}

const text = (value: string): ZipEntry['data'] => Buffer.from(value, 'utf8');

describe('zip builder', () => {
  it('round-trips entries byte for byte, in order, stored without compression', () => {
    const binary = Buffer.from(Array.from({ length: 5000 }, (_, i) => (i * 31) % 256));
    const zip = buildZip(
      [
        { name: 'media/01-cover.jpg', data: binary },
        { name: 'caption.txt', data: text('hello') },
        { name: 'empty.txt', data: new Uint8Array(0) },
      ],
      FIXED,
    );
    const parsed = readZip(zip);
    expect(parsed.map((p) => p.name)).toEqual(['media/01-cover.jpg', 'caption.txt', 'empty.txt']);
    expect(parsed[0]?.data.equals(binary)).toBe(true);
    expect(parsed[1]?.data.toString()).toBe('hello');
    expect(parsed[2]?.data.length).toBe(0);
    for (const entry of parsed) {
      expect(entry.method).toBe(0);
      expect(entry.crc).toBe(crc32(entry.data));
    }
  });

  it('keeps Thai text in file contents exactly (UTF-8, normalisation untouched)', () => {
    const thai = 'สวัสดีครับ ราคาพิเศษวันนี้ #สินค้าใหม่\n';
    const parsed = readZip(buildZip([{ name: 'caption.txt', data: text(thai) }], FIXED));
    expect(parsed[0]?.data.toString('utf8')).toBe(thai);
  });

  it('is reproducible for a fixed time and differs when the content differs', () => {
    const a = buildZip([{ name: 'a.txt', data: text('one') }], FIXED);
    const b = buildZip([{ name: 'a.txt', data: text('one') }], FIXED);
    const c = buildZip([{ name: 'a.txt', data: text('two') }], FIXED);
    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
  });

  it('streams in chunks that join to the same archive', () => {
    const entries = [
      { name: 'a.txt', data: text('one') },
      { name: 'b.txt', data: text('two') },
    ];
    const chunks = [...zipChunks(entries, FIXED)];
    expect(chunks.length).toBeGreaterThan(2);
    expect(Buffer.concat(chunks).equals(buildZip(entries, FIXED))).toBe(true);
  });

  it('is accepted by unzip when it is installed', () => {
    const probe = spawnSync('unzip', ['-v']);
    if (probe.error) return; // not installed here; the reader above still proves the layout
    const dir = mkdtempSync(join(tmpdir(), 'zip-test-'));
    try {
      const file = join(dir, 'p.zip');
      writeFileSync(
        file,
        buildZip(
          [
            { name: 'media/01-cover.jpg', data: Buffer.alloc(1000, 7) },
            { name: 'caption.txt', data: text('สวัสดี') },
          ],
          FIXED,
        ),
      );
      const result = spawnSync('unzip', ['-t', file], { encoding: 'utf8' });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('No errors detected');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each([
    ['empty', ''],
    ['traversal', '../evil.txt'],
    ['nested traversal', 'media/../../evil.txt'],
    ['absolute', '/etc/passwd'],
    ['drive letter', 'C:/x.txt'],
    ['backslash', 'media\\a.txt'],
    ['Thai name', 'รูป.jpg'],
    ['double slash', 'media//a.txt'],
    ['trailing slash', 'media/'],
    ['dot part', './a.txt'],
    ['trailing dot', 'a.'],
    ['space', 'a b.txt'],
    ['control character', 'a\u0000.txt'],
    ['too long', `${'a'.repeat(201)}.txt`],
  ])('refuses the name: %s', (_label, name) => {
    expect(() => buildZip([{ name, data: text('x') }], FIXED)).toThrow(ZipError);
  });

  it('refuses two entries with the same name, ignoring case', () => {
    expect(() =>
      buildZip(
        [
          { name: 'Caption.txt', data: text('1') },
          { name: 'caption.TXT', data: text('2') },
        ],
        FIXED,
      ),
    ).toThrow(expect.objectContaining({ code: 'DUPLICATE_NAME' }));
  });

  it('refuses before producing any chunk', () => {
    const generator = zipChunks(
      [
        { name: 'ok.txt', data: text('x') },
        { name: '../bad.txt', data: text('y') },
      ],
      FIXED,
    );
    expect(() => generator.next()).toThrow(ZipError);
  });

  it('refuses more than 1000 entries', () => {
    const entries = Array.from({ length: 1001 }, (_, i) => ({
      name: `f${String(i)}.txt`,
      data: text('x'),
    }));
    expect(() => buildZip(entries, FIXED)).toThrow(
      expect.objectContaining({ code: 'TOO_MANY_ENTRIES' }),
    );
  });

  it('refuses an archive that would need ZIP64, without copying the data', () => {
    // Fake lengths: allocating gigabytes in a test is not needed to prove the rule.
    const fake = (length: number): Uint8Array =>
      ({
        length,
        buffer: new ArrayBuffer(0),
        byteOffset: 0,
        byteLength: 0,
      }) as unknown as Uint8Array;
    expect(() => buildZip([{ name: 'big.bin', data: fake(0xffff_ffff) }], FIXED)).toThrow(
      expect.objectContaining({ code: 'TOO_LARGE' }),
    );
  });

  it('refuses when many entries together exceed the archive limit', () => {
    const fake = (length: number): Uint8Array =>
      ({
        length,
        buffer: new ArrayBuffer(0),
        byteOffset: 0,
        byteLength: 0,
      }) as unknown as Uint8Array;
    const half = 0x8000_0000;
    expect(() =>
      buildZip(
        [
          { name: 'a.bin', data: fake(half) },
          { name: 'b.bin', data: fake(half) },
        ],
        FIXED,
      ),
    ).toThrow(expect.objectContaining({ code: 'TOO_LARGE' }));
  });
});
