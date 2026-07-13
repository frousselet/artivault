import type { Context } from 'hono';
import { Hono } from 'hono';
import { requireAdmin } from '../../auth/session.js';
import { recordAudit } from '../../services/audit.js';
import { buildInviteUrl, createInvitation } from '../../services/invitations.js';
import {
  countActiveAdmins,
  createUser,
  getUserByEmail,
  getUserById,
  listUsersWithCounts,
  type UserWithCounts,
  updateUser,
} from '../../services/users.js';
import type { Role, User } from '../../types/domain.js';
import { AppError, conflict, forbidden, notFound, notImplemented } from '../../util/http.js';

// Admin API (spec §7, §15). Admins manage accounts and the system, and may list
// everyone's resources as METADATA ONLY — never their content.
export const adminRoutes = new Hono();

async function readBody(c: Context): Promise<Record<string, unknown>> {
  return (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function asRole(v: unknown): Role {
  if (v === 'admin' || v === 'user') return v;
  throw new AppError(400, 'bad_request', "role must be 'admin' or 'user'");
}

function userDto(u: User, credentialCount = 0, artifactCount = 0) {
  return {
    id: u.id,
    email: u.email,
    displayName: u.display_name,
    role: u.role,
    disabled: u.disabled === 1,
    createdAt: u.created_at,
    credentialCount,
    artifactCount,
  };
}

const withCountsDto = (u: UserWithCounts) => userDto(u, u.credential_count, u.artifact_count);

// --- Users (spec §7) ---
adminRoutes.get('/users', (c) => {
  requireAdmin(c);
  return c.json({ users: listUsersWithCounts().map(withCountsDto) });
});

adminRoutes.post('/users', async (c) => {
  const { user: actor } = requireAdmin(c);
  const body = await readBody(c);
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(email)) throw new AppError(400, 'bad_request', 'a valid email is required');
  if (getUserByEmail(email)) throw conflict('a user with this email already exists');
  const displayName =
    typeof body.displayName === 'string' && body.displayName.trim()
      ? body.displayName.trim()
      : email;
  const role = body.role === undefined ? 'user' : asRole(body.role);
  const user = createUser({ email, displayName, role, actorId: actor.id });
  const { token, invitation } = createInvitation(user.id, actor.id);
  recordAudit({
    actorId: actor.id,
    actorKind: 'user',
    action: 'admin.user.create',
    resourceKind: null,
    resourceId: user.id,
    detail: { email, role },
  });
  return c.json(
    {
      user: userDto(user),
      invite: { url: buildInviteUrl(token), expiresAt: invitation.expires_at },
    },
    201,
  );
});

// Generate a fresh invitation link for an existing (passkey-less) user.
adminRoutes.post('/users/:id/invite', (c) => {
  const { user: actor } = requireAdmin(c);
  const target = getUserById(c.req.param('id'));
  if (!target) throw notFound('user not found');
  const { token, invitation } = createInvitation(target.id, actor.id);
  recordAudit({
    actorId: actor.id,
    actorKind: 'user',
    action: 'admin.user.invite',
    resourceKind: null,
    resourceId: target.id,
  });
  return c.json({ invite: { url: buildInviteUrl(token), expiresAt: invitation.expires_at } }, 201);
});

adminRoutes.patch('/users/:id', async (c) => {
  const { user: actor } = requireAdmin(c);
  const targetId = c.req.param('id');
  if (targetId === actor.id) {
    throw forbidden('you cannot change your own admin account here');
  }
  const target = getUserById(targetId);
  if (!target) throw notFound('user not found');

  const body = await readBody(c);
  const changes: { role?: Role; disabled?: boolean } = {};
  if (body.role !== undefined) changes.role = asRole(body.role);
  if (body.disabled !== undefined) {
    if (typeof body.disabled !== 'boolean') {
      throw new AppError(400, 'bad_request', 'disabled must be a boolean');
    }
    changes.disabled = body.disabled;
  }
  if (changes.role === undefined && changes.disabled === undefined) {
    throw new AppError(400, 'bad_request', 'provide role and/or disabled');
  }

  // Never leave the system without an active admin (spec §7).
  const removesAdmin =
    target.role === 'admin' && (changes.role === 'user' || changes.disabled === true);
  if (removesAdmin && countActiveAdmins() <= 1) {
    throw conflict('cannot remove the last active admin');
  }

  const updated = updateUser(targetId, changes);
  recordAudit({
    actorId: actor.id,
    actorKind: 'user',
    action: 'admin.user.update',
    resourceKind: null,
    resourceId: targetId,
    detail: changes,
  });
  return c.json({ user: userDto(updated) });
});

// --- Metadata-only listings and system (spec §15) — still to build. ---
adminRoutes.get('/artifacts', (c) => notImplemented(c, 'admin_list_artifacts_metadata'));
adminRoutes.get('/datasets', (c) => notImplemented(c, 'admin_list_datasets_metadata'));
adminRoutes.get('/audit', (c) => notImplemented(c, 'admin_audit_log'));
adminRoutes.get('/oauth-clients', (c) => notImplemented(c, 'admin_list_oauth_clients'));
adminRoutes.delete('/oauth-clients/:id', (c) => notImplemented(c, 'admin_revoke_oauth_client'));
