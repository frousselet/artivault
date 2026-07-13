import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { verifyCapabilityToken } from '../../security/capability-tokens.js';
import { getDatasetById, getLinkedDatasets, queryDataset } from '../../services/datasets.js';
import type { Dataset } from '../../types/domain.js';
import { AppError } from '../../util/http.js';

export const renderDataRoutes = new Hono();

// A rendered artifact lives in a sandbox with an opaque origin (no
// `allow-same-origin`, see security/csp.ts), so its fetch to these endpoints is
// cross-origin with `Origin: null`. Allow any origin: the capability token in the
// URL is the grant and no cookies are involved, so `*` (non-credentialed) is safe
// — and it deliberately keeps the session cookie out of dataset access. This also
// answers the CORS preflight for the JSON `POST /:token/query`.
renderDataRoutes.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
    maxAge: 86_400,
  }),
);

// Data access for a sandboxed artifact via capability token (spec §11, §12). No
// session/cookie: the token is the grant, read-only, bound to an artifact+dataset.
async function loadFromToken(token: string): Promise<Dataset> {
  let claims: Awaited<ReturnType<typeof verifyCapabilityToken>>;
  try {
    claims = await verifyCapabilityToken(token);
  } catch {
    throw new AppError(401, 'invalid_token', 'invalid or expired token');
  }
  const dataset = getDatasetById(claims.datasetId);
  if (!dataset) throw new AppError(404, 'not_found', 'dataset not found');
  // The token was minted for a linked dataset; re-check the link is still present.
  if (!getLinkedDatasets(claims.artifactId).some((d) => d.id === dataset.id)) {
    throw new AppError(403, 'forbidden', 'dataset is no longer linked to this artifact');
  }
  return dataset;
}

// Inline datasets: return the whole content.
renderDataRoutes.get('/:token', async (c) => {
  const dataset = await loadFromToken(c.req.param('token'));
  c.header('Cache-Control', 'no-store');
  if (dataset.storage !== 'inline') {
    throw new AppError(400, 'bad_request', 'this dataset is queried via POST /query');
  }
  c.header(
    'Content-Type',
    dataset.format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
  );
  return c.body(dataset.content ?? '');
});

// SQLite datasets: run a read-only SELECT and return only the result rows.
renderDataRoutes.post('/:token/query', async (c) => {
  const dataset = await loadFromToken(c.req.param('token'));
  c.header('Cache-Control', 'no-store');
  const body = (await c.req.json().catch(() => ({}))) as { sql?: unknown };
  const sql = typeof body.sql === 'string' ? body.sql : '';
  if (!sql.trim()) throw new AppError(400, 'bad_request', 'sql is required');
  return c.json(queryDataset(dataset, sql));
});
