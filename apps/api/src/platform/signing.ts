import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

/**
 * Signed URLs for uploads and media (D-038, D-039). Each purpose gets its own key, derived from
 * SESSION_SECRET with HKDF, so a signature made for one purpose can never validate for another
 * even if a request were forged across them.
 */
export type SigningPurpose = 'upload' | 'media';

const BASE64URL_43 = /^[A-Za-z0-9_-]{43}$/;

export function deriveKey(secret: string, purpose: SigningPurpose): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), `creatorops:${purpose}:v1`, 32));
}

function mac(key: Buffer, purpose: SigningPurpose, parts: readonly string[]): Buffer {
  for (const part of parts) {
    // The "|" separator must be unambiguous, so no part may contain it.
    if (part.includes('|')) throw new Error('Signature parts must not contain "|"');
  }
  return createHmac('sha256', key)
    .update(['v1', purpose, ...parts].join('|'))
    .digest();
}

export function sign(key: Buffer, purpose: SigningPurpose, parts: readonly string[]): string {
  return mac(key, purpose, parts).toString('base64url');
}

/** Constant-time check of a signature in its canonical encoding. */
export function verify(
  key: Buffer,
  purpose: SigningPurpose,
  parts: readonly string[],
  signature: string,
): boolean {
  if (!BASE64URL_43.test(signature)) return false;
  const given = Buffer.from(signature, 'base64url');
  if (given.toString('base64url') !== signature) return false;
  const expected = mac(key, purpose, parts);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Parses an `exp` query value (seconds since the epoch); null unless it is a plain integer. */
export function parseExpiry(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{1,12}$/.test(value)) return null;
  return Number(value);
}
