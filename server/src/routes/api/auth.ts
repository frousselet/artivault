import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { issueCsrfToken } from '../../auth/csrf.js';
import {
  finishPasskeyAuthentication,
  finishPasskeyRegistration,
  startPasskeyAuthentication,
  startPasskeyRegistration,
} from '../../auth/passkeys.js';
import { createSession, destroySession, getAuth, setSessionCookie } from '../../auth/session.js';
import { config } from '../../config/env.js';
import { recordAudit } from '../../services/audit.js';
import {
  countCredentialsByUser,
  deleteCredential,
  listCredentialsByUser,
} from '../../services/credentials.js';
import { countUsers, createUser, getUserByEmail } from '../../services/users.js';
import type { User } from '../../types/domain.js';
import { AppError, forbidden, unauthorized } from '../../util/http.js';

export const authRoutes = new Hono();

function publicUser(user: User) {
  return { id: user.id, email: user.email, displayName: user.display_name, role: user.role };
}

function clientIp(c: Context): string | null {
  if (config.TRUST_PROXY) {
    const fwd = c.req.header('x-forwarded-for');
    if (fwd) return fwd.split(',')[0]?.trim() ?? null;
  }
  return c.req.header('x-real-ip') ?? null;
}

function deviceNameFrom(c: Context, provided: unknown): string | null {
  if (typeof provided === 'string' && provided.trim()) return provided.trim().slice(0, 80);
  const ua = c.req.header('user-agent');
  return ua ? ua.slice(0, 80) : null;
}

async function readBody(c: Context): Promise<Record<string, unknown>> {
  return (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
}

// Issue a CSRF token so the SPA can perform writes (spec §10). GET → not itself guarded.
authRoutes.get('/csrf', (c) => c.json({ csrfToken: issueCsrfToken(c) }));

authRoutes.get('/session', (c) => {
  const auth = getAuth(c);
  if (!auth) return c.json({ authenticated: false });
  return c.json({ authenticated: true, user: publicUser(auth.user) });
});

authRoutes.post('/logout', (c) => {
  destroySession(c);
  return c.json({ ok: true });
});

// --- Passkey registration (spec §10) ---
authRoutes.post('/register/options', async (c) => {
  const body = await readBody(c);
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const auth = getAuth(c);

  let user: User;
  if (auth) {
    // Logged in: registering an additional device for the current user.
    user = auth.user;
  } else {
    if (!email) throw new AppError(400, 'bad_request', 'email is required');
    const existing = getUserByEmail(email);
    if (existing) {
      // Only allow claiming the first passkey; otherwise a session is required.
      if (countCredentialsByUser(existing.id) > 0) {
        throw forbidden('this account already has a passkey; sign in to add a device');
      }
      user = existing;
    } else if (countUsers() === 0) {
      // Bootstrap: the very first account becomes admin (spec §10).
      const displayName =
        typeof body.displayName === 'string' && body.displayName.trim()
          ? body.displayName.trim()
          : email;
      user = createUser({ email, displayName });
    } else {
      throw forbidden('registration is closed; ask an admin to create your account');
    }
  }

  return c.json(await startPasskeyRegistration(c, user));
});

authRoutes.post('/register/verify', async (c) => {
  const body = await readBody(c);
  if (typeof body.response !== 'object' || body.response === null) {
    throw new AppError(400, 'bad_request', 'missing WebAuthn response');
  }
  const user = await finishPasskeyRegistration(
    c,
    body.response as RegistrationResponseJSON,
    deviceNameFrom(c, body.deviceName),
  );
  setSessionCookie(c, createSession(user.id, c.req.header('user-agent') ?? null));
  recordAudit({ actorId: user.id, actorKind: 'user', action: 'passkey.register', ip: clientIp(c) });
  return c.json({ ok: true, user: publicUser(user) });
});

// --- Passkey login (spec §10) ---
authRoutes.post('/login/options', async (c) => {
  const body = await readBody(c);
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const user = email ? getUserByEmail(email) : null;
  return c.json(await startPasskeyAuthentication(c, user));
});

authRoutes.post('/login/verify', async (c) => {
  const body = await readBody(c);
  if (typeof body.response !== 'object' || body.response === null) {
    throw new AppError(400, 'bad_request', 'missing WebAuthn response');
  }
  const user = await finishPasskeyAuthentication(c, body.response as AuthenticationResponseJSON);
  setSessionCookie(c, createSession(user.id, c.req.header('user-agent') ?? null));
  recordAudit({ actorId: user.id, actorKind: 'user', action: 'passkey.login', ip: clientIp(c) });
  return c.json({ ok: true, user: publicUser(user) });
});

// --- Passkey (device) management ---
authRoutes.get('/passkeys', (c) => {
  const auth = getAuth(c);
  if (!auth) throw unauthorized();
  const passkeys = listCredentialsByUser(auth.user.id).map((cred) => ({
    id: cred.id,
    deviceName: cred.device_name,
    createdAt: cred.created_at,
    lastUsedAt: cred.last_used_at,
  }));
  return c.json({ passkeys });
});

authRoutes.delete('/passkeys/:id', (c) => {
  const auth = getAuth(c);
  if (!auth) throw unauthorized();
  const id = c.req.param('id');
  if (!deleteCredential(auth.user.id, id))
    throw new AppError(404, 'not_found', 'passkey not found');
  recordAudit({
    actorId: auth.user.id,
    actorKind: 'user',
    action: 'passkey.delete',
    detail: { id },
  });
  return c.json({ ok: true });
});
