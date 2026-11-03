import { describe, expect, it } from 'vitest';

import { startup } from './startup.js';
import { SKIP_DB_TESTS, validEnv } from './test/db-url.js';

function io() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      stdout: { write: (c: string) => void out.push(c) },
      stderr: { write: (c: string) => void err.push(c) },
    },
    out,
    err,
  };
}

describe('startup', () => {
  it('exits 1 and names the variable when configuration is missing', async () => {
    const { io: streams, err } = io();
    const code = await startup({}, streams);
    expect(code).toBe(1);
    expect(err.join('')).toContain('DATABASE_URL');
    expect(err.join('')).toContain('Invalid configuration');
  });

  it('exits 1 for malformed configuration without leaking secret values', async () => {
    const { io: streams, err } = io();
    const code = await startup(validEnv({ SESSION_SECRET: 'leaky-short-1' }), streams);
    expect(code).toBe(1);
    expect(err.join('')).toContain('SESSION_SECRET');
    expect(err.join('')).not.toContain('leaky-short-1');
  });

  it('exits 1 with a readable message and no credentials when the database is unreachable', async () => {
    const { io: streams, out, err } = io();
    const code = await startup(
      validEnv({ DATABASE_URL: 'postgres://creatorops:supersecret@127.0.0.1:1/creatorops' }),
      streams,
    );
    expect(code).toBe(1);
    expect(err.join('')).toContain('Database connection failed');
    expect(err.join('') + out.join('')).not.toContain('supersecret');
  });

  it.skipIf(SKIP_DB_TESTS)(
    'exits 0 and logs a connection event when the database answers',
    async () => {
      const { io: streams, out, err } = io();
      const code = await startup(validEnv({ LOG_LEVEL: 'info' }), streams);
      expect(err.join('')).toBe('');
      expect(code).toBe(0);
      expect(out.join('')).toContain('db.connected');
    },
  );
});
