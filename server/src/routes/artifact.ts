import { Hono } from 'hono';
import { applyArtifactSandbox } from '../security/csp.js';

export const artifactRoutes = new Hono();

/**
 * GET /artifact/:slug — sandboxed artifact render (spec §11).
 * The isolation CSP is applied unconditionally; access control by visibility is TODO.
 */
artifactRoutes.get('/:slug', (c) => {
  applyArtifactSandbox(c);
  const slug = c.req.param('slug');
  // TODO(spec §11): resolve the artifact by slug and enforce visibility —
  //   private  → require a session cookie + permission check
  //   public   → allow (the unguessable slug is the grant)
  // Then render: html/svg as authored, markdown via renderMarkdownToHtml; and mint
  // capability tokens for linked datasets, injecting their /api/render-data/<token> URLs.
  return c.html(placeholderDocument(slug));
});

function placeholderDocument(slug: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Artivault — artifact</title>
  </head>
  <body style="font-family: system-ui, sans-serif; margin: 2rem; color: #333;">
    <h1>Artivault artifact renderer</h1>
    <p>This route serves artifact <code>${escapeHtml(slug)}</code> inside a sandboxed, opaque origin.</p>
    <p>Rendering is not implemented yet (scaffold). The isolation
       <code>Content-Security-Policy: sandbox …</code> header is already applied.</p>
  </body>
</html>`;
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}
