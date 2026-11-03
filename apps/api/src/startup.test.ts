import { describe, expect, it } from 'vitest';

import { prepare } from './startup.js';
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

describe('prepare', () => {
  it('fails with exit code 1 and names the variable when configuration is missing', async () => {
    const { io: streams, err } = io();
    const result = await prepare({}, streams);
    expect(result).toEqual({ ok: false, exitCode: 1 });
    expect(err.join('')).toContain('DATABASE_URL');
    expect(err.join('')).toContain('Invalid configuration');
  });

  it('fails for malformed configuration without leaking secret values', async () => {
    const { io: streams, err } = io();
    const result = await prepare(validEnv({ SESSION_SECRET: 'leaky-short-1' }), streams);
    expect(result.ok).toBe(false);
    expect(err.join('')).toContain('SESSION_SECRET');
    expect(err.join('')).not.toContain('leaky-short-1');
  });

  it('fails with a readable message and no credentials when the database is unreachable', async () => {
    const { io: streams, out, err } = io();
    const result = await prepare(
      validEnv({ DATABASE_URL: 'postgres://creatorops:supersecret@127.0.0.1:1/creatorops' }),
      streams,
    );
    expect(result).toEqual({ ok: false, exitCode: 1 });
    expect(err.join('')).toContain('Database connection failed');
    expect(err.join('') + out.join('')).not.toContain('supersecret');
  });

  it.skipIf(SKIP_DB_TESTS)(
    'returns config, logger and a working pool when the database answers',
    async () => {
      const { io: streams, out, err } = io();
      const result = await prepare(validEnv({ LOG_LEVEL: 'info' }), streams);
      expect(err.join('')).toBe('');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      try {
        expect(out.join('')).toContain('db.connected');
        expect((await result.pool.query('select 1 as ok')).rows[0]).toEqual({ ok: 1 });
      } finally {
        await result.pool.end();
      }
    },
  );
});
