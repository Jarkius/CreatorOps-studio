import { ConfigError } from '@creatorops/config';
import { describe, expect, it } from 'vitest';

import { validEnv } from '../test/db-url.js';
import { loadConfig } from './config.js';

function failure(env: Record<string, string | undefined>): ConfigError {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error('expected loadConfig to throw');
}

describe('loadConfig', () => {
  it('parses a valid environment and applies defaults', () => {
    const config = loadConfig(validEnv());
    expect(config.PORT).toBe(3000);
    expect(config.LOG_LEVEL).toBe('info');
    expect(config.AUTH_MODE).toBe('mock');
    expect(config.EXTENSION_ORIGIN).toBeUndefined();
  });

  it('returns a frozen object', () => {
    expect(Object.isFrozen(loadConfig(validEnv()))).toBe(true);
  });

  it('names each missing required variable', () => {
    const error = failure({});
    const names = error.issues.map((issue) => issue.variable);
    expect(names).toEqual(
      expect.arrayContaining([
        'DATABASE_URL',
        'AUTH_MODE',
        'API_BASE_URL',
        'WEB_ORIGIN',
        'SESSION_SECRET',
      ]),
    );
  });

  it('rejects a DATABASE_URL that is not a postgres URL, without echoing it', () => {
    const error = failure(validEnv({ DATABASE_URL: 'mysql://root:topsecret@localhost/db' }));
    expect(error.message).toContain('DATABASE_URL');
    expect(error.message).not.toContain('topsecret');
  });

  it('rejects a WEB_ORIGIN with a path or trailing slash', () => {
    expect(failure(validEnv({ WEB_ORIGIN: 'http://localhost:5173/' })).message).toContain(
      'WEB_ORIGIN',
    );
    expect(failure(validEnv({ WEB_ORIGIN: 'http://localhost:5173/app' })).message).toContain(
      'WEB_ORIGIN',
    );
  });

  it('rejects a short SESSION_SECRET without echoing it', () => {
    const error = failure(validEnv({ SESSION_SECRET: 'tooshort-1234' }));
    expect(error.message).toContain('SESSION_SECRET');
    expect(error.message).not.toContain('tooshort-1234');
  });

  it('accepts a well-formed EXTENSION_ORIGIN and rejects a malformed one', () => {
    const id = 'abcdefghijklmnopabcdefghijklmnop';
    expect(
      loadConfig(validEnv({ EXTENSION_ORIGIN: `chrome-extension://${id}` })).EXTENSION_ORIGIN,
    ).toBe(`chrome-extension://${id}`);
    expect(
      failure(validEnv({ EXTENSION_ORIGIN: 'chrome-extension://change-me' })).message,
    ).toContain('EXTENSION_ORIGIN');
    expect(failure(validEnv({ EXTENSION_ORIGIN: '*' })).message).toContain('EXTENSION_ORIGIN');
  });

  it('refuses mock authentication when NODE_ENV is production', () => {
    const error = failure(validEnv({ NODE_ENV: 'production', AUTH_MODE: 'mock' }));
    expect(error.issues).toContainEqual({
      variable: 'AUTH_MODE',
      problem: expect.stringContaining('cannot run with NODE_ENV=production') as string,
    });
  });

  it('rejects an unknown AUTH_MODE', () => {
    expect(failure(validEnv({ AUTH_MODE: 'none' })).message).toContain('AUTH_MODE');
  });

  it('rejects an out-of-range PORT', () => {
    expect(failure(validEnv({ PORT: '70000' })).message).toContain('PORT');
    expect(failure(validEnv({ PORT: 'abc' })).message).toContain('PORT');
  });

  it('refuses mock authentication on a non-loopback HOST unless explicitly allowed', () => {
    for (const host of ['0.0.0.0', '192.168.1.10', 'example.com']) {
      const error = failure(validEnv({ HOST: host }));
      expect(
        error.issues.map((issue) => issue.variable),
        host,
      ).toContain('HOST');
    }
    expect(loadConfig(validEnv({ HOST: '0.0.0.0', ALLOW_MOCK_AUTH_ON_NETWORK: 'true' })).HOST).toBe(
      '0.0.0.0',
    );
    for (const host of ['127.0.0.1', 'localhost', '::1', '[::1]']) {
      expect(loadConfig(validEnv({ HOST: host })).HOST, host).toBe(host);
    }
  });

  it('rejects a malformed ALLOW_MOCK_AUTH_ON_NETWORK', () => {
    expect(failure(validEnv({ ALLOW_MOCK_AUTH_ON_NETWORK: 'maybe' })).message).toContain(
      'ALLOW_MOCK_AUTH_ON_NETWORK',
    );
  });

  it('parses TRUST_PROXY_HOPS with a safe default and bounds', () => {
    expect(loadConfig(validEnv()).TRUST_PROXY_HOPS).toBe(0);
    expect(loadConfig(validEnv({ TRUST_PROXY_HOPS: '2' })).TRUST_PROXY_HOPS).toBe(2);
    expect(failure(validEnv({ TRUST_PROXY_HOPS: '-1' })).message).toContain('TRUST_PROXY_HOPS');
    expect(failure(validEnv({ TRUST_PROXY_HOPS: '11' })).message).toContain('TRUST_PROXY_HOPS');
  });

  it('treats REDIS_URL as optional and accepts redis and rediss URLs', () => {
    expect(loadConfig(validEnv()).REDIS_URL).toBeUndefined();
    const plain = 'redis://default:pw@127.0.0.1:6379';
    expect(loadConfig(validEnv({ REDIS_URL: plain })).REDIS_URL).toBe(plain);
    const secure = 'rediss://:pw@cache.internal:6380';
    expect(loadConfig(validEnv({ REDIS_URL: secure })).REDIS_URL).toBe(secure);
  });

  it('rejects a REDIS_URL that is not a redis URL without echoing it', () => {
    const error = failure(validEnv({ REDIS_URL: 'http://user:topsecret@host' }));
    expect(error.issues.map((issue) => issue.variable)).toContain('REDIS_URL');
    expect(error.message).not.toContain('topsecret');
  });

  it('accepts SECRETS_ENCRYPTION_KEY only as 32 base64 bytes, never echoes it, and defaults its id', () => {
    const good = Buffer.alloc(32, 7).toString('base64');
    expect(loadConfig(validEnv()).SECRETS_ENCRYPTION_KEY).toBeUndefined();
    expect(loadConfig(validEnv()).SECRETS_ENCRYPTION_KEY_ID).toBe('k1');
    expect(loadConfig(validEnv({ SECRETS_ENCRYPTION_KEY: good })).SECRETS_ENCRYPTION_KEY).toBe(
      good,
    );
    for (const bad of [
      Buffer.alloc(16).toString('base64'),
      'not-base64!',
      'short',
      good.slice(0, -1),
    ]) {
      expect(() => loadConfig(validEnv({ SECRETS_ENCRYPTION_KEY: bad }))).toThrow();
      try {
        loadConfig(validEnv({ SECRETS_ENCRYPTION_KEY: bad }));
      } catch (error) {
        expect(String(error)).not.toContain(bad);
      }
    }
    expect(() => loadConfig(validEnv({ SECRETS_ENCRYPTION_KEY_ID: 'Bad Id!' }))).toThrow();
  });
});
