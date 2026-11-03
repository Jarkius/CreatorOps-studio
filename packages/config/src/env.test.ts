import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ConfigError, parseEnv } from './env.js';

const schema = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    MODE: z.enum(['a', 'b']),
    SECRET: z.string().min(12),
  })
  .superRefine((env, ctx) => {
    if (env.MODE === 'b' && env.PORT === 1) {
      ctx.addIssue({ code: 'custom', path: ['MODE'], message: 'b is not allowed on port 1' });
    }
  });

function failure(source: Record<string, string | undefined>): ConfigError {
  try {
    parseEnv(schema, source);
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error('expected parseEnv to throw');
}

describe('parseEnv', () => {
  it('returns typed values and applies defaults and coercion', () => {
    const env = parseEnv(schema, { MODE: 'a', SECRET: 'long-enough-value', PORT: '8080' });
    expect(env).toEqual({ MODE: 'a', SECRET: 'long-enough-value', PORT: 8080 });
    expect(parseEnv(schema, { MODE: 'a', SECRET: 'long-enough-value' }).PORT).toBe(3000);
  });

  it('names every missing variable', () => {
    const error = failure({});
    const names = error.issues.map((issue) => issue.variable);
    expect(names).toEqual(expect.arrayContaining(['MODE', 'SECRET']));
    expect(error.message).toContain('MODE: is required but not set');
    expect(error.message).toContain('SECRET: is required but not set');
  });

  it('names malformed variables and says what is wrong', () => {
    const error = failure({ MODE: 'zzz', SECRET: 'long-enough-value', PORT: 'abc' });
    expect(error.message).toContain('MODE: is not one of the allowed values');
    expect(error.message).toContain('PORT');
  });

  it('never includes a variable value in the message', () => {
    const secret = 'q7Zx1';
    const error = failure({ MODE: 'a', SECRET: secret, PORT: 'not-a-number-9x7' });
    expect(error.message).not.toContain(secret);
    expect(error.message).not.toContain('not-a-number-9x7');
    expect(error.message).toContain('SECRET');
  });

  it('reports cross-variable rules against the variable named by the rule', () => {
    const error = failure({ MODE: 'b', SECRET: 'long-enough-value', PORT: '1' });
    expect(error.issues).toContainEqual({
      variable: 'MODE',
      problem: 'b is not allowed on port 1',
    });
  });
});
