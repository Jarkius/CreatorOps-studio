import { describe, expect, it } from 'vitest';

import { signToken, verifyToken, type TokenPayload } from './token.js';

const SECRET = 'unit-test-secret-unit-test-secret-0123';
const NOW = 1_800_000_000;
const payload: TokenPayload = {
  sub: '5b1b6f0e-8d2f-4f6e-9a39-1c1f7a1a0001',
  iat: NOW,
  exp: NOW + 60,
};

function parts(token: string): [string, string, string] {
  return token.split('.') as [string, string, string];
}

describe('signToken / verifyToken', () => {
  it('round-trips a valid token', () => {
    expect(verifyToken(signToken(payload, SECRET), SECRET, NOW)).toEqual(payload);
  });

  it('rejects a token signed with a different secret', () => {
    const token = signToken(payload, 'another-secret-another-secret-another-0');
    expect(verifyToken(token, SECRET, NOW)).toBeNull();
  });

  it('rejects a tampered payload even when the signature is kept', () => {
    const [version, , signature] = parts(signToken(payload, SECRET));
    const forged = Buffer.from(JSON.stringify({ ...payload, sub: 'someone-else' })).toString(
      'base64url',
    );
    expect(verifyToken(`${version}.${forged}.${signature}`, SECRET, NOW)).toBeNull();
  });

  it('rejects a tampered or truncated signature', () => {
    const [version, body, signature] = parts(signToken(payload, SECRET));
    const flipped = `${signature.slice(0, -2)}${signature.endsWith('AA') ? 'BB' : 'AA'}`;
    expect(verifyToken(`${version}.${body}.${flipped}`, SECRET, NOW)).toBeNull();
    expect(verifyToken(`${version}.${body}.${signature.slice(0, 10)}`, SECRET, NOW)).toBeNull();
    expect(verifyToken(`${version}.${body}.`, SECRET, NOW)).toBeNull();
  });

  it('rejects an expired token, including one that expires exactly now', () => {
    const token = signToken(payload, SECRET);
    expect(verifyToken(token, SECRET, payload.exp)).toBeNull();
    expect(verifyToken(token, SECRET, payload.exp + 1)).toBeNull();
    expect(verifyToken(token, SECRET, payload.exp - 1)).not.toBeNull();
  });

  it('rejects non-canonical encodings of an otherwise valid signature', () => {
    const [version, body, signature] = parts(signToken(payload, SECRET));
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    // A sha256 signature is 43 base64url characters whose last character has 2 unused bits, so
    // changing those bits decodes to the same bytes. It must still be refused.
    const last = alphabet.indexOf(signature.slice(-1));
    const sibling = alphabet[last ^ 1] ?? 'A';
    expect(
      verifyToken(`${version}.${body}.${signature.slice(0, -1)}${sibling}`, SECRET, NOW),
    ).toBeNull();
    expect(verifyToken(`${version}.${body}.${signature}=`, SECRET, NOW)).toBeNull();
    expect(verifyToken(`${version}.${body}.${signature}\n`, SECRET, NOW)).toBeNull();
    expect(verifyToken(`${version}.${body}!.${signature}`, SECRET, NOW)).toBeNull();
    expect(verifyToken(`${version}.${body}.${signature}`, SECRET, NOW)).not.toBeNull();
  });

  it('rejects unknown versions and malformed shapes', () => {
    const [, body, signature] = parts(signToken(payload, SECRET));
    expect(verifyToken(`v2.${body}.${signature}`, SECRET, NOW)).toBeNull();
    expect(verifyToken('', SECRET, NOW)).toBeNull();
    expect(verifyToken('abc', SECRET, NOW)).toBeNull();
    expect(verifyToken(`v1.${body}`, SECRET, NOW)).toBeNull();
    expect(verifyToken(`v1.${body}.${signature}.extra`, SECRET, NOW)).toBeNull();
  });

  it('rejects a correctly signed body that is not valid JSON or has the wrong fields', () => {
    for (const body of [
      Buffer.from('not json').toString('base64url'),
      Buffer.from(JSON.stringify({ sub: 1, iat: NOW, exp: NOW + 60 })).toString('base64url'),
      Buffer.from(JSON.stringify({ sub: '', iat: NOW, exp: NOW + 60 })).toString('base64url'),
      Buffer.from(JSON.stringify({ sub: 'x', iat: 'now', exp: NOW + 60 })).toString('base64url'),
      Buffer.from(JSON.stringify(null)).toString('base64url'),
    ]) {
      const token = signToken({} as TokenPayload, SECRET); // only to reuse the signer's format
      void token;
      // Sign the raw body the same way signToken does, to isolate the payload checks.
      const forged = forge(body);
      expect(verifyToken(forged, SECRET, NOW)).toBeNull();
    }
  });
});

import { createHmac } from 'node:crypto';

function forge(body: string): string {
  const signingInput = `v1.${body}`;
  return `${signingInput}.${createHmac('sha256', SECRET).update(signingInput).digest('base64url')}`;
}
