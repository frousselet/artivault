import { Hono } from 'hono';
import { getAuth } from '../auth/session.js';
import { applyArtifactSandbox } from '../security/csp.js';
import { getArtifactBySlug } from '../services/artifacts.js';
import { artifactAccess, canView } from '../services/authorization.js';
import { renderArtifactHtml, renderContentType } from '../services/render.js';

export const artifactRoutes = new Hono();

/**
 * GET /artifact/:slug — sandboxed artifact render (spec §11). The isolation CSP is
 * applied unconditionally; access depends on visibility (public → open, private →
 * session + permission).
 */
artifactRoutes.get('/:slug', (c) => {
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

  // TODO(spec §11, §12): mint capability tokens for linked datasets and inject
  // their /api/render-data/<token> URLs into the document.

  c.header('Content-Type', renderContentType(artifact.kind));
  return c.body(renderArtifactHtml(artifact.kind, artifact.content));
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
