/**
 * Database tests read the connection string from DATABASE_URL (D-026). A missing value fails
 * loudly rather than skipping, so CI cannot pass without exercising the database. Set
 * SKIP_DB_TESTS=1 to opt out explicitly on a machine without PostgreSQL.
 */
export const SKIP_DB_TESTS = process.env.SKIP_DB_TESTS === '1';

export function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (url) return url;
  if (SKIP_DB_TESTS) return 'postgres://skipped@localhost:5432/skipped';
  throw new Error(
    'DATABASE_URL is not set. Start PostgreSQL with `pnpm dev:db` and export DATABASE_URL ' +
      '(`bash scripts/pg-local.sh url`), or set SKIP_DB_TESTS=1 to skip database tests explicitly.',
  );
}

export function validEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: 'test',
    DATABASE_URL: requireDatabaseUrl(),
    AUTH_MODE: 'mock',
    API_BASE_URL: 'http://localhost:3000',
    WEB_ORIGIN: 'http://localhost:5173',
    SESSION_SECRET: 'test-secret-test-secret-test-secret-0123',
    ...overrides,
  };
}

/** The session secret used by validEnv(); tests that mint tokens directly need it. */
export const SECRET_FOR_TESTS = 'test-secret-test-secret-test-secret-0123';
