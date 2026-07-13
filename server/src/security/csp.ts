import type { Context } from 'hono';

/**
 * Sandbox CSP for rendered artifacts (spec §11). Crucially omits
 * `allow-same-origin`, placing the document in an opaque origin so its scripts
 * cannot read the application's cookies/localStorage or make credentialed
 * same-origin calls to `/api`. Do not add `allow-same-origin` here.
 */
export const ARTIFACT_SANDBOX_CSP = 'sandbox allow-scripts allow-forms allow-popups';

/** Apply the isolation headers to an artifact render response. */
export function applyArtifactSandbox(c: Context): void {
  c.header('Content-Security-Policy', ARTIFACT_SANDBOX_CSP);
  c.header('X-Content-Type-Options', 'nosniff');
  // Avoid caching private artifact content on shared proxies.
  c.header('Cache-Control', 'no-store');
}
