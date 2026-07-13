import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Context, Next } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { config } from '../config/env.js';
import { AppError } from '../util/http.js';

export const CSRF_COOKIE = 'av_csrf';
export const CSRF_HEADER = 'x-csrf-token';

/** Issue a readable (non-HttpOnly) CSRF cookie the SPA echoes back in a header. */
export function issueCsrfToken(c: Context): string {
  const token = randomBytes(32).toString('base64url');
  setCookie(c, CSRF_COOKIE, token, {
    httpOnly: false,
    secure: config.cookieSecure,
    sameSite: 'Lax',
    path: '/',
    maxAge: config.SESSION_TTL_SECONDS,
  });
  return token;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Double-submit CSRF check for state-changing /api requests (spec §10). Untrusted
 * artifact content is served from the same origin, so the session cookie alone is
 * not sufficient for writes.
 * TODO(spec §10): additionally bind the CSRF token to the session.
 */
export async function requireCsrf(c: Context, next: Next): Promise<void> {
  const method = c.req.method;
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    const cookie = getCookie(c, CSRF_COOKIE);
    const header = c.req.header(CSRF_HEADER);
    if (!cookie || !header || !safeEqual(cookie, header)) {
      throw new AppError(403, 'csrf_failed', 'missing or invalid CSRF token');
    }
  }
  await next();
}
