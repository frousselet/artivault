import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { config } from './config/env.js';
import { apiRoutes } from './routes/api/index.js';
import { artifactRoutes } from './routes/artifact.js';
import { healthRoutes } from './routes/health.js';
import { mcpRoutes } from './routes/mcp.js';
import { oauthRoutes } from './routes/oauth.js';
import { AppError } from './util/http.js';
import { logger } from './util/logger.js';

// Route prefixes owned by the backend. A miss under these returns a JSON 404
// rather than the SPA shell, so API clients never receive HTML by surprise.
const API_PREFIXES = [
  '/api',
  '/artifact',
  '/oauth',
  '/mcp',
  '/.well-known',
  '/healthz',
  '/readyz',
  '/assets',
];

const isApiPath = (path: string): boolean =>
  API_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));

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

  // Serve the built SPA (web/dist) when present, so the GUI and API share one
  // origin — the production topology. Registered after the API routes, so it can
  // only ever handle paths they didn't. Absent (dev/tests), `/` is a hint and the
  // GUI is served by Vite on :5173.
  const indexHtmlPath = join(config.webDistDir, 'index.html');
  const hasWeb = existsSync(indexHtmlPath);
  const indexHtml = hasWeb ? readFileSync(indexHtmlPath, 'utf8') : '';
  if (hasWeb) {
    // serveStatic resolves `root` relative to the process CWD.
    const root = relative(process.cwd(), config.webDistDir) || '.';
    app.use('*', serveStatic({ root }));
  } else {
    app.get('/', (c) =>
      c.text('Artivault API is running. In development, run `npm run dev:web` for the GUI.'),
    );
  }

  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json({ error: err.code, message: err.message }, err.status);
    }
    logger.error('unhandled error', { path: c.req.path, message: (err as Error).message });
    return c.json({ error: 'internal_error' }, 500);
  });

  // Unmatched routes: hand browser navigations to the SPA (client-side routing,
  // e.g. /invite/<token>); everything else — and any API miss — gets JSON.
  app.notFound((c) => {
    if (hasWeb && c.req.method === 'GET' && !isApiPath(c.req.path)) {
      return c.html(indexHtml);
    }
    return c.json({ error: 'not_found' }, 404);
  });

  return app;
}
