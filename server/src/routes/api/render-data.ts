import { Hono } from 'hono';
import { verifyCapabilityToken } from '../../security/capability-tokens.js';
import { notImplemented } from '../../util/http.js';

export const renderDataRoutes = new Hono();

/**
 * GET /api/render-data/:token — data access for a sandboxed artifact (spec §11, §12).
 * No session/cookie: the capability token is the grant, and it is read-only.
 */
renderDataRoutes.get('/:token', async (c) => {
  const token = c.req.param('token');
  let claims: Awaited<ReturnType<typeof verifyCapabilityToken>>;
  try {
    claims = await verifyCapabilityToken(token);
  } catch {
    return c.json({ error: 'invalid_or_expired_token' }, 401);
  }
  c.header('Cache-Control', 'no-store');
  // TODO(spec §12): load the dataset bound to claims.datasetId —
  //   inline      → return the CSV/JSON content whole
  //   sqlite_file → accept a SELECT and return only result rows (query_only,
  //                 statement timeout, caps on rows/bytes).
  return notImplemented(c, `render_data:${claims.datasetId}`);
});
