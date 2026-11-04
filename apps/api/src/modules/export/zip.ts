import { crc32 } from 'node:zlib';

/**
 * Pure, dependency-free ZIP writer for export packages (S5.6, D-067).
 *
 * - Entries are stored without compression (images and video are already compressed).
 * - Entry names are server-generated ASCII; the builder refuses anything else, so a name can never
 *   carry a path traversal, a drive letter or a Thai byte that readers decode differently.
 * - UTF-8 text goes inside the files, not into the names.
 * - No ZIP64: the whole archive must stay under 4 GiB (the export cap is 500 MB).
 * - The archive is produced as a sequence of chunks, so only one file is in memory at a time.
 */

export interface ZipEntry {
  /** ASCII path with forward slashes, for example `media/01-cover.jpg`. */
  name: string;
  data: Uint8Array;
}

export class ZipError extends Error {
  readonly code: 'BAD_NAME' | 'DUPLICATE_NAME' | 'TOO_LARGE' | 'TOO_MANY_ENTRIES';

  constructor(code: ZipError['code'], message: string) {
    super(message);
    this.name = 'ZipError';
    this.code = code;
  }
}

const MAX_ENTRIES = 1000;
const MAX_NAME_BYTES = 200;
const MAX_ARCHIVE_BYTES = 0xffff_ffff - 1024 * 1024;
const MAX_ENTRY_BYTES = 0xffff_ffff - 1024 * 1024;

/** Names that are safe on every unzip tool: ASCII letters, digits and `._-`, with `/` between parts. */
const NAME_PART = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function assertSafeEntryName(name: string): void {
  if (name.length === 0 || Buffer.byteLength(name, 'utf8') > MAX_NAME_BYTES) {
    throw new ZipError('BAD_NAME', 'entry name is empty or too long');
  }
  const parts = name.split('/');
  for (const part of parts) {
    if (!NAME_PART.test(part) || part.endsWith('.')) {
      throw new ZipError('BAD_NAME', 'entry name has a part that is not allowed');
    }
  }
}

/** DOS date and time for a fixed instant (the archive is reproducible when the time is passed in). */
function dosDateTime(at: Date): { time: number; date: number } {
  const year = Math.min(Math.max(at.getUTCFullYear(), 1980), 2107);
  return {
    time: (at.getUTCHours() << 11) | (at.getUTCMinutes() << 5) | Math.floor(at.getUTCSeconds() / 2),
    date: ((year - 1980) << 9) | ((at.getUTCMonth() + 1) << 5) | at.getUTCDate(),
  };
}

const VERSION_NEEDED = 20;
/** Bit 11: names and comments are UTF-8. Names are ASCII, so this is harmless and explicit. */
const FLAGS = 0x0800;

function localHeader(
  nameBytes: Buffer,
  crc: number,
  size: number,
  stamp: { time: number; date: number },
): Buffer {
  const header = Buffer.alloc(30 + nameBytes.length);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(VERSION_NEEDED, 4);
  header.writeUInt16LE(FLAGS, 6);
  header.writeUInt16LE(0, 8); // stored
  header.writeUInt16LE(stamp.time, 10);
  header.writeUInt16LE(stamp.date, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(size, 18);
  header.writeUInt32LE(size, 22);
  header.writeUInt16LE(nameBytes.length, 26);
  header.writeUInt16LE(0, 28);
  nameBytes.copy(header, 30);
  return header;
}

function centralHeader(
  nameBytes: Buffer,
  crc: number,
  size: number,
  offset: number,
  stamp: { time: number; date: number },
): Buffer {
  const header = Buffer.alloc(46 + nameBytes.length);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE((3 << 8) | VERSION_NEEDED, 4); // made by: Unix, 2.0
  header.writeUInt16LE(VERSION_NEEDED, 6);
  header.writeUInt16LE(FLAGS, 8);
  header.writeUInt16LE(0, 10); // stored
  header.writeUInt16LE(stamp.time, 12);
  header.writeUInt16LE(stamp.date, 14);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(size, 20);
  header.writeUInt32LE(size, 24);
  header.writeUInt16LE(nameBytes.length, 28);
  header.writeUInt16LE(0, 30); // extra
  header.writeUInt16LE(0, 32); // comment
  header.writeUInt16LE(0, 34); // disk
  header.writeUInt16LE(0, 36); // internal attributes
  header.writeUInt32LE(((0o100644 << 16) >>> 0) as number, 38); // regular file, rw-r--r--
  header.writeUInt32LE(offset, 42);
  nameBytes.copy(header, 46);
  return header;
}

function endRecord(count: number, centralSize: number, centralOffset: number): Buffer {
  const record = Buffer.alloc(22);
  record.writeUInt32LE(0x06054b50, 0);
  record.writeUInt16LE(0, 4);
  record.writeUInt16LE(0, 6);
  record.writeUInt16LE(count, 8);
  record.writeUInt16LE(count, 10);
  record.writeUInt32LE(centralSize, 12);
  record.writeUInt32LE(centralOffset, 16);
  record.writeUInt16LE(0, 20);
  return record;
}

/**
 * Yields the archive in chunks. Entries are validated before the first chunk, so a bad name or an
 * oversized archive fails with nothing written. `at` fixes the timestamps (default: now).
 */
export function* zipChunks(entries: readonly ZipEntry[], at: Date = new Date()): Generator<Buffer> {
  if (entries.length > MAX_ENTRIES) {
    throw new ZipError('TOO_MANY_ENTRIES', 'too many entries');
  }
  const seen = new Set<string>();
  let total = 22;
  for (const entry of entries) {
    assertSafeEntryName(entry.name);
    const key = entry.name.toLowerCase();
    if (seen.has(key)) throw new ZipError('DUPLICATE_NAME', 'two entries share a name');
    seen.add(key);
    if (entry.data.length > MAX_ENTRY_BYTES) throw new ZipError('TOO_LARGE', 'entry too large');
    total += 30 + 46 + 2 * entry.name.length + entry.data.length;
    if (total > MAX_ARCHIVE_BYTES) throw new ZipError('TOO_LARGE', 'archive too large');
  }

  const stamp = dosDateTime(at);
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, 'ascii');
    const crc = crc32(entry.data);
    const header = localHeader(nameBytes, crc, entry.data.length, stamp);
    central.push(centralHeader(nameBytes, crc, entry.data.length, offset, stamp));
    yield header;
    yield Buffer.from(entry.data.buffer, entry.data.byteOffset, entry.data.byteLength);
    offset += header.length + entry.data.length;
  }

  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  for (const part of central) yield part;
  yield endRecord(entries.length, centralSize, offset);
}

/** Whole archive in one buffer (small packages and tests). */
export function buildZip(entries: readonly ZipEntry[], at?: Date): Buffer {
  return Buffer.concat([...zipChunks(entries, at)]);
}
