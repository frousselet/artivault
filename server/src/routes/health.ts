import { Hono } from 'hono';
import { getDb } from '../db/index.js';

export const healthRoutes = new Hono();

healthRoutes.get('/healthz', (c) =>
  c.json({ status: 'ok', service: 'artivault', uptime: process.uptime() }),
);

healthRoutes.get('/readyz', (c) => {
  try {
    getDb().prepare('SELECT 1').get();
    return c.json({ status: 'ok', db: 'ok' });
  } catch (err) {
    return c.json({ status: 'error', db: 'unavailable', message: (err as Error).message }, 503);
  }
});
