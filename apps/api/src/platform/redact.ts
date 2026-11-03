/**
 * Redaction for everything that can reach a log line (docs/05 section 2, D-028).
 *
 * Rules:
 * - Values under sensitive keys (authorization, cookie, password, secret, token, api key,
 *   private key, signature, credential) are replaced. Numbers and booleans under such keys
 *   are kept, so usage counters such as `inputTokens` stay visible.
 * - Strings are scrubbed for bearer/basic credentials, passwords inside connection URLs,
 *   and the whole query string of any URL or path (signed media URLs carry their signature
 *   there).
 * - Binary data is never logged, only its size.
 * - Errors are flattened to plain objects with scrubbed message and stack.
 */

export const REDACTED = '[REDACTED]';

const SENSITIVE_KEY =
  /authorization|cookie|passw(or)?d|secret|token|api[-_]?key|private[-_]?key|signature|credential|^sig$/i;

const MAX_DEPTH = 8;

const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9\-._~+/]+=*/gi;
// scheme://user:password@host -> keep user, hide password
const URL_PASSWORD = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+):[^\s@/]+@/gi;
// absolute URL with a query string
const ABSOLUTE_URL_QUERY = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>?#]*)\?[^\s"'<>#]*/gi;
// path (starting with "/") with a query string
const PATH_QUERY = /(^|[\s"'(])(\/[^\s?"'<>#]*)\?[^\s"'<>#]*/g;

export function redactString(value: string): string {
  return value
    .replace(BEARER, `$1 ${REDACTED}`)
    .replace(URL_PASSWORD, `$1:${REDACTED}@`)
    .replace(ABSOLUTE_URL_QUERY, `$1?${REDACTED}`)
    .replace(PATH_QUERY, `$1$2?${REDACTED}`);
}

function isBinary(value: unknown): value is ArrayBufferView | ArrayBuffer {
  return value instanceof ArrayBuffer || ArrayBuffer.isView(value);
}

function redactError(error: Error, depth: number, seen: WeakSet<object>): Record<string, unknown> {
  const plain: Record<string, unknown> = {
    type: error.name,
    message: redactString(error.message),
  };
  if (error.stack !== undefined) plain.stack = redactString(error.stack);
  for (const [key, entry] of Object.entries(error)) {
    plain[key] = redactEntry(key, entry, depth + 1, seen);
  }
  return plain;
}

function redactEntry(key: string, value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (SENSITIVE_KEY.test(key) && typeof value !== 'number' && typeof value !== 'boolean') {
    return value === undefined || value === null ? value : REDACTED;
  }
  return redactValue(value, depth, seen);
}

export function redactValue(
  value: unknown,
  depth = 0,
  seen: WeakSet<object> = new WeakSet(),
): unknown {
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') return value;
  if (isBinary(value)) return `[binary ${value.byteLength} bytes]`;
  if (depth >= MAX_DEPTH) return '[max depth]';
  if (seen.has(value)) return '[circular]';
  seen.add(value);

  if (value instanceof Error) return redactError(value, depth, seen);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1, seen));

  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    out[key] = redactEntry(key, entry, depth + 1, seen);
  }
  return out;
}
