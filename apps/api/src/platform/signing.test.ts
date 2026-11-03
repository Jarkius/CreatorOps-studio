import { describe, expect, it } from 'vitest';

import { deriveKey, parseExpiry, sign, verify } from './signing.js';

const SECRET = 'signing-test-secret-signing-test-secret-01';
const parts = ['asset-1', 'workspace-1', 'thumb', '1800000000'];

describe('signing', () => {
  it('verifies a signature made for the same purpose and parts', () => {
    const key = deriveKey(SECRET, 'media');
    expect(verify(key, 'media', parts, sign(key, 'media', parts))).toBe(true);
  });

  it('is deterministic and key-dependent', () => {
    const media = deriveKey(SECRET, 'media');
    expect(sign(media, 'media', parts)).toBe(sign(media, 'media', parts));
    expect(
      sign(deriveKey('another-secret-another-secret-another-0', 'media'), 'media', parts),
    ).not.toBe(sign(media, 'media', parts));
  });

  it('keeps purposes apart: an upload signature never validates as a media signature', () => {
    const upload = deriveKey(SECRET, 'upload');
    const media = deriveKey(SECRET, 'media');
    expect(upload.equals(media)).toBe(false);
    const signature = sign(upload, 'upload', parts);
    expect(verify(media, 'media', parts, signature)).toBe(false);
    // Even with the same key material, the purpose is part of what is signed.
    expect(verify(upload, 'media', parts, signature)).toBe(false);
  });

  it('rejects any change to the signed parts', () => {
    const key = deriveKey(SECRET, 'media');
    const signature = sign(key, 'media', parts);
    for (let i = 0; i < parts.length; i += 1) {
      const changed = parts.map((part, j) => (i === j ? `${part}x` : part));
      expect(verify(key, 'media', changed, signature), `part ${i}`).toBe(false);
    }
    expect(verify(key, 'media', parts.slice(0, -1), signature)).toBe(false);
    expect(verify(key, 'media', [...parts, 'extra'], signature)).toBe(false);
  });

  it('cannot be confused by moving content across the separator', () => {
    const key = deriveKey(SECRET, 'media');
    expect(() => sign(key, 'media', ['a|b', 'c'])).toThrow(/must not contain/);
    expect(sign(key, 'media', ['a', 'b|c'.replace('|', '')])).not.toBe(
      sign(key, 'media', ['ab', 'c']),
    );
  });

  it('accepts only the canonical 43-character encoding', () => {
    const key = deriveKey(SECRET, 'media');
    const signature = sign(key, 'media', parts);
    expect(signature).toHaveLength(43);
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const sibling = alphabet[alphabet.indexOf(signature.slice(-1)) ^ 1] ?? 'A';
    for (const bad of [
      `${signature}=`,
      `${signature}\n`,
      signature.slice(0, -1),
      `${signature.slice(0, -1)}${sibling}`,
      '',
      'x'.repeat(43),
    ]) {
      expect(verify(key, 'media', parts, bad), bad).toBe(false);
    }
  });
});

describe('parseExpiry', () => {
  it('accepts plain integers and rejects everything else', () => {
    expect(parseExpiry('1800000000')).toBe(1_800_000_000);
    for (const bad of [
      undefined,
      null,
      5,
      '',
      '-1',
      '1.5',
      '1e9',
      ' 12',
      '12 ',
      '1'.repeat(13),
      ['1'],
      '0x10',
    ]) {
      expect(parseExpiry(bad), String(bad)).toBeNull();
    }
  });
});
