import { serve } from '@hono/node-server';
import { buildApp } from './app.js';
import { config } from './config/env.js';
import { closeDb, getDb } from './db/index.js';
import { runMigrations } from './db/migrate.js';
import { logger } from './util/logger.js';

// Open the database and bring the schema up to date before serving.
const { applied } = runMigrations(getDb());
if (applied.length > 0) {
  logger.info('applied migrations', { count: applied.length, files: applied });
}

const app = buildApp();

const server = serve({ fetch: app.fetch, hostname: config.HOST, port: config.PORT }, (info) => {
  logger.info('artivault listening', {
    url: `http://${config.HOST}:${info.port}`,
    publicBaseUrl: config.PUBLIC_BASE_URL,
    env: config.NODE_ENV,
  });
});

function shutdown(signal: string): void {
  logger.info('shutting down', { signal });
  server.close(() => {
    closeDb();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
