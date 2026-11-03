import type { FastifyInstance } from 'fastify';

import { buildApp, type AppOptions } from '../app.js';
import { loadConfig } from '../platform/config.js';
import { createLogger } from '../platform/logger.js';
import { validEnv } from './db-url.js';

export interface MakeAppOverrides extends Partial<Omit<AppOptions, 'config' | 'logger'>> {
  /** Environment variables layered over validEnv(). */
  readonly env?: Record<string, string | undefined>;
}

export interface TestApp {
  readonly app: FastifyInstance;
  /** Raw log output, one entry per line. */
  readonly logs: string[];
  /** Log output parsed as JSON, one object per line. */
  logLines(): Record<string, unknown>[];
}

/**
 * Builds an app whose logs are captured in memory. Callers must close `app` when done.
 * Extra options (for example registerRoutes, rateLimitMax, bodyLimit) pass straight through.
 */
export async function makeApp({
  env,
  ...optionOverrides
}: MakeAppOverrides = {}): Promise<TestApp> {
  const logs: string[] = [];
  const stream = {
    write: (chunk: string): void => {
      for (const line of chunk.split('\n')) {
        if (line.length > 0) logs.push(line);
      }
    },
  };
  const app = await buildApp({
    config: loadConfig(validEnv(env)),
    logger: createLogger({ level: 'info', stream }),
    ...optionOverrides,
  });
  return {
    app,
    logs,
    logLines: () => logs.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}
