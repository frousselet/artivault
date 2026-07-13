import type { ArtifactKind } from '../types/domain.js';
import { renderMarkdownToHtml } from './markdown.js';

const MARKDOWN_HEAD = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font-family: system-ui, -apple-system, sans-serif; max-width: 46rem;
         margin: 2rem auto; padding: 0 1rem; line-height: 1.65; color: #1a1a1a; }
  @media (prefers-color-scheme: dark) { body { color: #e8e8e8; background: #14161a; } }
  pre { overflow: auto; background: rgba(127,127,127,0.12); padding: 1rem; border-radius: 8px; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  img, table { max-width: 100%; }
</style></head><body>`;

/**
 * Produce the document body for an artifact (spec §11). HTML and SVG are served
 * as authored; Markdown is rendered to HTML server-side and wrapped in a minimal
 * document. The output is always served through the sandboxed render path.
 */
export function renderArtifactHtml(kind: ArtifactKind, content: string, bootstrap = ''): string {
  if (kind === 'markdown') {
    return `${MARKDOWN_HEAD}${bootstrap}${renderMarkdownToHtml(content)}</body></html>`;
  }
  if (kind === 'html') return `${bootstrap}${content}`;
  return content; // svg: served as authored (no bootstrap injection)
}

/** Content-Type for the render response, given the artifact kind. */
export function renderContentType(kind: ArtifactKind): string {
  return kind === 'svg' ? 'image/svg+xml; charset=utf-8' : 'text/html; charset=utf-8';
}
