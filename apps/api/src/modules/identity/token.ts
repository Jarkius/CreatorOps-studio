import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Development bearer tokens (D-027): `v1.<payload>.<signature>`, where payload is base64url
 * JSON `{ sub, iat, exp }` and signature is HMAC-SHA256 over `v1.<payload>` keyed with
 * SESSION_SECRET. Only the mock auth mode issues them.
 */
export interface TokenPayload {
  /** User id. */
  readonly sub: string;
  /** Issued-at, seconds since the epoch. */
  readonly iat: number;
  /** Expiry, seconds since the epoch. */
  readonly exp: number;
}

const VERSION = 'v1';
export const TOKEN_TTL_SECONDS = 12 * 60 * 60;

function sign(secret: string, signingInput: string): Buffer {
  return createHmac('sha256', secret).update(signingInput).digest();
}

export function signToken(payload: TokenPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signingInput = `${VERSION}.${body}`;
  return `${signingInput}.${sign(secret, signingInput).toString('base64url')}`;
}

const BASE64URL = /^[A-Za-z0-9_-]+$/;

function isPayload(value: unknown): value is TokenPayload {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.sub === 'string' &&
    record.sub.length > 0 &&
    typeof record.iat === 'number' &&
    typeof record.exp === 'number'
  );
}

/** Returns the payload for a valid, unexpired token, or null for anything else. */
export function verifyToken(
  token: string,
  secret: string,
  nowSeconds: number,
): TokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== VERSION) return null;
  const [, body, signature] = parts as [string, string, string];

  // Accept only the canonical encoding. Buffer.from(..., 'base64url') ignores stray characters
  // and unused low bits, so without this check many different strings would verify as one token.
  if (!BASE64URL.test(body) || !BASE64URL.test(signature)) return null;
  const expected = sign(secret, `${VERSION}.${body}`);
  const given = Buffer.from(signature, 'base64url');
  if (given.toString('base64url') !== signature) return null;
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!isPayload(payload) || payload.exp <= nowSeconds) return null;
  return payload;
}
