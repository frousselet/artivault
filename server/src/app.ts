import { Hono } from 'hono';
import { apiRoutes } from './routes/api/index.js';
import { artifactRoutes } from './routes/artifact.js';
import { healthRoutes } from './routes/health.js';
import { mcpRoutes } from './routes/mcp.js';
import { oauthRoutes } from './routes/oauth.js';
import { AppError } from './util/http.js';
import { logger } from './util/logger.js';

/** Build the Hono application with all routes mounted. Used by the server and tests. */
export function buildApp(): Hono {
  const app = new Hono();

  // Conservative baseline headers for every response. The artifact render route
  // sets its own, stronger CSP (see security/csp.ts) — do not add a global CSP
  // here that would fight it.
  app.use('*', async (c, next) => {
    await next();
    c.header('Referrer-Policy', 'no-referrer');
    c.header('X-Content-Type-Options', 'nosniff');
  });

  app.route('/', healthRoutes);
  app.route('/', oauthRoutes); // /.well-known/* and /oauth/*
  app.route('/api', apiRoutes);
  app.route('/artifact', artifactRoutes);
  app.route('/mcp', mcpRoutes);

  // Root placeholder. TODO: in production, serve the built web/ SPA here
  // (e.g. @hono/node-server/serve-static over web/dist with an index.html fallback).
  app.get('/', (c) =>
    c.text('Artivault API is running. In development, run `npm run dev:web` for the GUI.'),
  );

  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json({ error: err.code, message: err.message }, err.status);
    }
    logger.error('unhandled error', { path: c.req.path, message: (err as Error).message });
    return c.json({ error: 'internal_error' }, 500);
  });

  app.notFound((c) => c.json({ error: 'not_found' }, 404));

  return app;
}
