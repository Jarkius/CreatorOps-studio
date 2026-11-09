import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { decryptSecret, encryptSecret, lastFour, parseSecretsKey, SecretError } from './secrets.js';

const key = () => parseSecretsKey(randomBytes(32).toString('base64'), 'k1');
const KEY = 'sk-or-v1-abcdef0123456789SECRET';

describe('provider key encryption (D-066)', () => {
  it('round-trips, and the stored value does not contain the plaintext', () => {
    const k = key();
    const stored = encryptSecret(KEY, k, 'ws-1');
    expect(stored).not.toContain(KEY);
    expect(stored).not.toContain(Buffer.from(KEY).toString('base64'));
    expect(stored.startsWith('v1.k1.')).toBe(true);
    expect(decryptSecret(stored, k, 'ws-1')).toBe(KEY);
  });

  it('uses a new nonce every time', () => {
    const k = key();
    expect(encryptSecret(KEY, k, 'ws-1')).not.toBe(encryptSecret(KEY, k, 'ws-1'));
  });

  it('keeps Unicode intact', () => {
    const k = key();
    expect(decryptSecret(encryptSecret('กุญแจ-🔑', k, 'w'), k, 'w')).toBe('กุญแจ-🔑');
  });

  it('refuses another workspace binding, another key, another key id, and any tampering', () => {
    const k = key();
    const stored = encryptSecret(KEY, k, 'ws-1');
    expect(() => decryptSecret(stored, k, 'ws-2')).toThrow(SecretError);
    expect(() => decryptSecret(stored, key(), 'ws-1')).toThrow(SecretError);
    expect(() => decryptSecret(stored, { ...k, id: 'k2' }, 'ws-1')).toThrow(
      /different encryption key/,
    );
    const parts = stored.split('.');
    const body = Buffer.from(parts[3]!, 'base64url');
    body[0] = (body[0] ?? 0) ^ 1;
    const tampered = [parts[0], parts[1], parts[2], body.toString('base64url')].join('.');
    expect(() => decryptSecret(tampered, k, 'ws-1')).toThrow(SecretError);
    for (const junk of ['', 'v1', 'v2.k1.a.b', 'v1.k1.short.short', 'v1.k1.AAAAAAAAAAAAAAAA.AA']) {
      expect(() => decryptSecret(junk, k, 'ws-1')).toThrow(SecretError);
    }
  });

  it('errors never carry the plaintext or the key', () => {
    const k = key();
    try {
      decryptSecret(encryptSecret(KEY, k, 'a'), k, 'b');
    } catch (error) {
      expect(String((error as Error).message)).not.toContain(KEY);
      expect(String((error as Error).message)).not.toContain(k.key.toString('base64'));
    }
  });

  it('rejects a key that is not 32 bytes', () => {
    expect(() => parseSecretsKey(Buffer.alloc(16).toString('base64'), 'k1')).toThrow(SecretError);
  });

  it('shows the last four characters only for a long secret', () => {
    expect(lastFour(KEY)).toBe('CRET');
    expect(lastFour('short')).toBe('');
  });
});
