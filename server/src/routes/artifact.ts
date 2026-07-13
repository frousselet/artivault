import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { getAuth } from '../auth/session.js';
import { mintCapabilityToken } from '../security/capability-tokens.js';
import { applyArtifactSandbox } from '../security/csp.js';
import { getArtifactBySlug } from '../services/artifacts.js';
import { artifactAccess, canView } from '../services/authorization.js';
import { getLinkedDatasets } from '../services/datasets.js';
import { renderArtifactHtml, renderContentType } from '../services/render.js';
import type { Artifact } from '../types/domain.js';

export const artifactRoutes = new Hono();

/**
 * Mint a short-lived capability token per linked dataset and inject their access
 * URLs as `window.ARTIVAULT.datasets` (spec §11). Skipped for SVG (served as-is).
 */
async function datasetBootstrap(artifact: Artifact): Promise<string> {
  if (artifact.kind === 'svg') return '';
  const datasets = getLinkedDatasets(artifact.id);
  if (datasets.length === 0) return '';
  const renderNonce = randomUUID();
  const entries = await Promise.all(
    datasets.map(async (d) => {
      const token = await mintCapabilityToken({
        artifactId: artifact.id,
        datasetId: d.id,
        renderNonce,
      });
      return {
        id: d.id,
        name: d.name,
        format: d.format,
        storage: d.storage,
        url: `/api/render-data/${token}`,
        queryUrl: `/api/render-data/${token}/query`,
      };
    }),
  );
  // Escape "<" so a dataset name can't break out of the <script>.
  const json = JSON.stringify({ datasets: entries }).replace(/</g, '\\u003c');
  return `<script>window.ARTIVAULT=${json};</script>`;
}

/**
 * GET /artifact/:slug — sandboxed artifact render (spec §11). The isolation CSP is
 * applied unconditionally; access depends on visibility (public → open, private →
 * session + permission).
 */
artifactRoutes.get('/:slug', async (c) => {
  applyArtifactSandbox(c);
  const artifact = getArtifactBySlug(c.req.param('slug'));
  if (!artifact) {
    return c.html(errorDocument('Not found', 'This artifact does not exist.'), 404);
  }

  if (artifact.visibility !== 'public') {
    const auth = getAuth(c);
    if (!auth) {
      return c.html(errorDocument('Sign in required', 'This artifact is private.'), 401);
    }
    if (!canView(artifactAccess(artifact, auth.user.id))) {
      return c.html(errorDocument('Forbidden', 'You do not have access to this artifact.'), 403);
    }
  }

  const bootstrap = await datasetBootstrap(artifact);
  c.header('Content-Type', renderContentType(artifact.kind));
  return c.body(renderArtifactHtml(artifact.kind, artifact.content, bootstrap));
});

function errorDocument(title: string, detail: string): string {
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head>
  <body style="font-family: system-ui, sans-serif; margin: 2rem; color: #444;">
    <h1>${title}</h1>
    <p>${detail}</p>
  </body>
</html>`;
}
