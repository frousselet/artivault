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
import { findUsableInvitation } from '../../services/invitations.js';
import { listAuthorizedClients, revokeClient } from '../../services/oauth.js';
import { countUsers, createUser, getUserByEmail, getUserById } from '../../services/users.js';
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

// Validate an invitation link and reveal the invited email so the SPA can show
// an onboarding screen. Public (the token is the capability), read-only.
authRoutes.get('/invite/:token', (c) => {
  const inv = findUsableInvitation(c.req.param('token'));
  if (!inv)
    throw new AppError(410, 'invalid_invitation', 'this invitation is invalid or has expired');
  const user = getUserById(inv.user_id);
  if (!user) throw new AppError(410, 'invalid_invitation', 'the invited account no longer exists');
  if (countCredentialsByUser(user.id) > 0) {
    throw new AppError(409, 'already_registered', 'this account already has a passkey');
  }
  return c.json({ email: user.email, displayName: user.display_name });
});

// --- Passkey registration (spec §10) ---
authRoutes.post('/register/options', async (c) => {
  const body = await readBody(c);
  const invite = typeof body.invite === 'string' ? body.invite : '';

  // 1. Invitation link — the token identifies the account (takes precedence).
  if (invite) {
    const inv = findUsableInvitation(invite);
    if (!inv) {
      throw new AppError(400, 'invalid_invitation', 'this invitation is invalid or has expired');
    }
    const user = getUserById(inv.user_id);
    if (!user) {
      throw new AppError(400, 'invalid_invitation', 'the invited account no longer exists');
    }
    if (countCredentialsByUser(user.id) > 0) {
      throw forbidden('this account already has a passkey');
    }
    return c.json(await startPasskeyRegistration(c, user, { invitationId: inv.id }));
  }

  // 2. Signed in — registering an additional device for the current user.
  const auth = getAuth(c);
  if (auth) {
    return c.json(await startPasskeyRegistration(c, auth.user));
  }

  // 3. Bootstrap — the very first account self-registers by email and becomes admin.
  if (countUsers() === 0) {
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!email) throw new AppError(400, 'bad_request', 'email is required');
    const displayName =
      typeof body.displayName === 'string' && body.displayName.trim()
        ? body.displayName.trim()
        : email;
    return c.json(await startPasskeyRegistration(c, createUser({ email, displayName })));
  }

  throw forbidden('registration requires an invitation — ask an admin for a link');
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

// --- Authorized MCP apps (OAuth clients, spec §13) ---
authRoutes.get('/oauth-clients', (c) => {
  const auth = getAuth(c);
  if (!auth) throw unauthorized();
  return c.json({ clients: listAuthorizedClients(auth.user.id) });
});

authRoutes.delete('/oauth-clients/:clientId', (c) => {
  const auth = getAuth(c);
  if (!auth) throw unauthorized();
  const clientId = c.req.param('clientId');
  if (!revokeClient(auth.user.id, clientId)) throw new AppError(404, 'not_found', 'app not found');
  recordAudit({
    actorId: auth.user.id,
    actorKind: 'user',
    action: 'oauth.revoke',
    detail: { client: clientId },
  });
  return c.json({ ok: true });
});
