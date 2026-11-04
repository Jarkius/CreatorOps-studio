/**
 * Queue tests read the connection string from REDIS_URL (D-054). Like the database tests, a
 * missing value fails loudly so CI cannot pass without exercising Redis. Set SKIP_REDIS_TESTS=1
 * to opt out explicitly on a machine without Redis.
 */
export const SKIP_REDIS_TESTS = process.env.SKIP_REDIS_TESTS === '1';

export function requireRedisUrl(): string {
  const url = process.env.REDIS_URL;
  if (url) return url;
  if (SKIP_REDIS_TESTS) return 'redis://skipped@localhost:6379';
  throw new Error(
    'REDIS_URL is not set. Start Redis with `pnpm dev:redis` and export REDIS_URL ' +
      '(`bash scripts/redis-local.sh url`), or set SKIP_REDIS_TESTS=1 to skip Redis tests explicitly.',
  );
}
