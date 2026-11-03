import { buildApp } from './app.js';
import { prepare } from './startup.js';

const prepared = await prepare(process.env, {
  stdout: process.stdout,
  stderr: process.stderr,
});

if (!prepared.ok) {
  process.exitCode = prepared.exitCode;
} else {
  const { config, logger, pool } = prepared;
  const app = await buildApp({ config, logger, rateLimitMax: config.RATE_LIMIT_MAX });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ event: 'server.stopping', signal }, 'shutting down');
    await app.close();
    await pool.end();
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: config.PORT, host: config.HOST });
  logger.info({ event: 'server.started', port: config.PORT, host: config.HOST }, 'listening');
}
