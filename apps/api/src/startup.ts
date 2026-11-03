import { ConfigError, type EnvSource } from '@creatorops/config';
import type pg from 'pg';

import { loadConfig, type ApiConfig } from './platform/config.js';
import { checkDatabase, createPool } from './platform/db.js';
import { createLogger, type Logger } from './platform/logger.js';

export interface StartupIo {
  readonly stdout: { write(chunk: string): unknown };
  readonly stderr: { write(chunk: string): unknown };
}

export type Prepared =
  | {
      readonly ok: true;
      readonly config: ApiConfig;
      readonly logger: Logger;
      readonly pool: pg.Pool;
    }
  | { readonly ok: false; readonly exitCode: number };

/**
 * Validates configuration and confirms the database is reachable. On failure it writes a
 * readable message to stderr (never containing secret values) and returns an exit code. On
 * success the caller owns the returned pool and must end it.
 */
export async function prepare(env: EnvSource, io: StartupIo): Promise<Prepared> {
  let config: ApiConfig;
  try {
    config = loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) {
      io.stderr.write(`${error.message}\n`);
      return { ok: false, exitCode: 1 };
    }
    throw error;
  }

  const logger = createLogger({ level: config.LOG_LEVEL, stream: io.stdout });
  const pool = createPool(config.DATABASE_URL);
  try {
    await checkDatabase(pool);
    logger.info({ event: 'db.connected' }, 'database reachable');
    return { ok: true, config, logger, pool };
  } catch (error) {
    logger.error({ event: 'db.unreachable', err: error }, 'database connection failed');
    io.stderr.write(
      'Database connection failed. Check DATABASE_URL and that PostgreSQL is running (pnpm dev:db).\n',
    );
    await pool.end();
    return { ok: false, exitCode: 1 };
  }
}
