import { describe, expect, it } from 'vitest';

import { createLogger } from './logger.js';

function capture() {
  const lines: string[] = [];
  const stream = { write: (chunk: string) => void lines.push(chunk) };
  return { lines, logger: createLogger({ level: 'info', stream }) };
}

describe('createLogger', () => {
  it('redacts sensitive keys in log objects', () => {
    const { lines, logger } = capture();
    logger.info(
      { requestId: 'r1', req: { headers: { authorization: 'Bearer abc', 'x-api-key': 'k' } } },
      'incoming request',
    );
    const out = lines.join('');
    expect(out).toContain('"requestId":"r1"');
    expect(out).not.toContain('Bearer abc');
    expect(out).not.toContain('"x-api-key":"k"');
    expect(out).toContain('[REDACTED]');
  });

  it('redacts secrets inside the message text', () => {
    const { lines, logger } = capture();
    logger.warn('upstream said Bearer abc.def and https://x.test/m.jpg?sig=SECRET');
    const out = lines.join('');
    expect(out).not.toContain('abc.def');
    expect(out).not.toContain('SECRET');
  });

  it('redacts credentials inside errors', () => {
    const { lines, logger } = capture();
    logger.error({ err: new Error('connect postgres://u:hunter2@h:5432/d') }, 'db failed');
    const out = lines.join('');
    expect(out).not.toContain('hunter2');
    expect(out).toContain('db failed');
  });

  it('redacts logged values passed as interpolation arguments', () => {
    const { lines, logger } = capture();
    logger.info('signed url %s', '/api/v1/media/a?sig=SECRET');
    expect(lines.join('')).not.toContain('SECRET');
  });

  it('writes one JSON object per line with level and time', () => {
    const { lines, logger } = capture();
    logger.info({ event: 'x' }, 'hello');
    const parsed = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    expect(parsed).toMatchObject({ event: 'x', msg: 'hello', level: 30 });
    expect(typeof parsed.time).toBe('number');
  });

  it('respects the configured level', () => {
    const lines: string[] = [];
    const logger = createLogger({ level: 'error', stream: { write: (c) => void lines.push(c) } });
    logger.info('hidden');
    logger.error('shown');
    expect(lines).toHaveLength(1);
  });
});
