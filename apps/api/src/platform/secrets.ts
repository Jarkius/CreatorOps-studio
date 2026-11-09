import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Encrypts provider API keys for storage (D-066). AES-256-GCM with a random 96-bit nonce per
 * value. The workspace id is bound in as additional authenticated data, so a ciphertext copied to
 * another workspace's row fails to decrypt. Stored form: `v1.<keyId>.<nonce>.<ciphertext+tag>`
 * (base64url parts). The plaintext never leaves this module except through `decryptSecret`, which
 * only the worker calls.
 */
export interface SecretsKey {
  readonly id: string;
  readonly key: Buffer;
}

export class SecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretError';
  }
}

export function parseSecretsKey(base64: string, id: string): SecretsKey {
  const key = Buffer.from(base64, 'base64');
  if (key.length !== 32) throw new SecretError('The encryption key must be 32 bytes.');
  return { id, key };
}

const TAG_BYTES = 16;

export function encryptSecret(plaintext: string, secrets: SecretsKey, binding: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', secrets.key, nonce);
  cipher.setAAD(Buffer.from(binding, 'utf8'));
  const body = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return ['v1', secrets.id, nonce.toString('base64url'), body.toString('base64url')].join('.');
}

/** Throws SecretError (with a fixed message) for a wrong key, a wrong binding or a tampered value. */
export function decryptSecret(stored: string, secrets: SecretsKey, binding: string): string {
  const parts = stored.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1')
    throw new SecretError('The stored key is not valid.');
  if (parts[1] !== secrets.id)
    throw new SecretError('The stored key needs a different encryption key.');
  try {
    const nonce = Buffer.from(parts[2] ?? '', 'base64url');
    const body = Buffer.from(parts[3] ?? '', 'base64url');
    if (nonce.length !== 12 || body.length <= TAG_BYTES) throw new Error('shape');
    const decipher = createDecipheriv('aes-256-gcm', secrets.key, nonce);
    decipher.setAAD(Buffer.from(binding, 'utf8'));
    decipher.setAuthTag(body.subarray(body.length - TAG_BYTES));
    return Buffer.concat([
      decipher.update(body.subarray(0, body.length - TAG_BYTES)),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new SecretError('The stored key could not be decrypted.');
  }
}

/** The last four characters, for display. Shorter secrets show nothing. */
export function lastFour(secret: string): string {
  return secret.length >= 12 ? secret.slice(-4) : '';
}
