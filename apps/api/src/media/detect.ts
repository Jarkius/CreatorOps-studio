/**
 * Identifies a file by its first bytes (magic numbers), ignoring whatever the client claimed.
 * Only these types are accepted (D-038). SVG, HTML and everything else are rejected, since they
 * can carry script and are not needed for product photos or short clips.
 */
export const ALLOWED_MEDIA_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
] as const;
export type AllowedMediaType = (typeof ALLOWED_MEDIA_TYPES)[number];

export const EXTENSION_BY_TYPE: Readonly<Record<AllowedMediaType, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
};

/** Minimum number of leading bytes needed to decide. */
export const DETECT_BYTES = 16;

const MP4_BRANDS = new Set([
  'isom',
  'iso2',
  'iso4',
  'iso5',
  'iso6',
  'mp41',
  'mp42',
  'avc1',
  'M4V ',
  'dash',
  'msdh',
]);

export function detectMediaType(head: Uint8Array): AllowedMediaType | null {
  const bytes = Buffer.from(head.subarray(0, DETECT_BYTES));
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return 'image/jpeg';
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (bytes.length >= 6) {
    const tag = bytes.subarray(0, 6).toString('latin1');
    if (tag === 'GIF87a' || tag === 'GIF89a') return 'image/gif';
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString('latin1') === 'ftyp') {
    return MP4_BRANDS.has(bytes.subarray(8, 12).toString('latin1')) ? 'video/mp4' : null;
  }
  return null;
}

export function isAllowedMediaType(value: string): value is AllowedMediaType {
  return (ALLOWED_MEDIA_TYPES as readonly string[]).includes(value);
}

export const MAX_BYTES: Readonly<{ image: number; video: number }> = {
  image: 15 * 1024 * 1024,
  video: 200 * 1024 * 1024,
};

export function maxBytesFor(type: AllowedMediaType): number {
  return type.startsWith('video/') ? MAX_BYTES.video : MAX_BYTES.image;
}
