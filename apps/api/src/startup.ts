import { ConfigError, type EnvSource } from '@creatorops/config';

import { loadConfig } from './platform/config.js';
import { checkDatabase, createPool } from './platform/db.js';
import { createLogger } from './platform/logger.js';

export interface StartupIo {
  readonly stdout: { write(chunk: string): unknown };
  readonly stderr: { write(chunk: string): unknown };
}

/**
 * Validates configuration and confirms the database is reachable. Returns a process exit code:
 * 0 on success, 1 on any failure, with a readable message on stderr that never contains
 * secret values. The HTTP server is added on top of this in slice S1.1.
 */
export async function startup(env: EnvSource, io: StartupIo): Promise<number> {
  let config;
  try {
    config = loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) {
      io.stderr.write(`${error.message}\n`);
      return 1;
    }
    throw error;
  }

  const logger = createLogger({ level: config.LOG_LEVEL, stream: io.stdout });
  const pool = createPool(config.DATABASE_URL);
  try {
    await checkDatabase(pool);
    logger.info({ event: 'db.connected' }, 'database reachable');
    return 0;
  } catch (error) {
    logger.error({ event: 'db.unreachable', err: error }, 'database connection failed');
    io.stderr.write(
      'Database connection failed. Check DATABASE_URL and that PostgreSQL is running (pnpm dev:db).\n',
    );
    return 1;
  } finally {
    await pool.end();
  }
}
