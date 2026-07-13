import { createHash, randomBytes } from 'node:crypto';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { config } from '../config/env.js';
import { getDb } from '../db/index.js';
import type { Session, User } from '../types/domain.js';
import { forbidden, unauthorized } from '../util/http.js';
import { nowSeconds } from '../util/time.js';

export const SESSION_COOKIE = 'av_session';

/** The cookie carries a random token; the DB stores only its hash. */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Create a server-side session (spec §10) and return the opaque cookie token. */
export function createSession(userId: string, userAgent: string | null): string {
  const token = randomBytes(32).toString('base64url');
  const now = nowSeconds();
  getDb()
    .prepare(
      `INSERT INTO sessions (id, user_id, user_agent, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(hashToken(token), userId, userAgent, now, now + config.SESSION_TTL_SECONDS);
  return token;
}

export function setSessionCookie(c: Context, token: string): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.cookieSecure,
    // Lax so a top-level GET navigation to /artifact/<slug> still carries the cookie (spec §11).
    sameSite: 'Lax',
    path: '/',
    maxAge: config.SESSION_TTL_SECONDS,
  });
}

export interface Authenticated {
  session: Session;
  user: User;
}

/** Resolve the current session and user from the cookie, or null. Expired sessions are cleared. */
export function getAuth(c: Context): Authenticated | null {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const id = hashToken(token);
  const db = getDb();
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Session | undefined;
  if (!session) return null;
  if (session.expires_at <= nowSeconds()) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    return null;
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id) as
    | User
    | undefined;
  if (!user || user.disabled) return null;
  return { session, user };
}

export function destroySession(c: Context): void {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    getDb().prepare('DELETE FROM sessions WHERE id = ?').run(hashToken(token));
  }
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
}

/** Resolve the current session or throw 401. For session-guarded /api routes. */
export function requireAuth(c: Context): Authenticated {
  const auth = getAuth(c);
  if (!auth) throw unauthorized();
  return auth;
}

/** Require an authenticated admin, or throw 401/403 (spec §7). */
export function requireAdmin(c: Context): Authenticated {
  const auth = requireAuth(c);
  if (auth.user.role !== 'admin') throw forbidden('admin role required');
  return auth;
}
