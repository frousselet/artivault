import type { Context } from 'hono';
import { Hono } from 'hono';
import { requireAuth } from '../../auth/session.js';
import { config } from '../../config/env.js';
import {
  createArtifact,
  deleteArtifact,
  getArtifactById,
  listArtifactsForUser,
  listArtifactVersions,
  setArtifactVisibility,
  updateArtifact,
} from '../../services/artifacts.js';
import { recordAudit } from '../../services/audit.js';
import {
  type Access,
  artifactAccess,
  canEdit,
  canView,
  isOwner,
} from '../../services/authorization.js';
import { acquireLock, getActiveLock, releaseLock } from '../../services/locks.js';
import { renderArtifactHtml } from '../../services/render.js';
import { listSharesWithGrantee, removeShare, setShare } from '../../services/shares.js';
import { getUserByEmail } from '../../services/users.js';
import type { Artifact, ArtifactKind, Lock, Permission } from '../../types/domain.js';
import { AppError, conflict, forbidden, notFound } from '../../util/http.js';

export const artifactApiRoutes = new Hono();

const base = config.PUBLIC_BASE_URL.replace(/\/+$/, '');
const renderUrl = (slug: string) => `${base}/artifact/${slug}`;

async function readBody(c: Context): Promise<Record<string, unknown>> {
  return (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
}

function asKind(v: unknown): ArtifactKind {
  if (v === 'html' || v === 'svg' || v === 'markdown') return v;
  throw new AppError(400, 'bad_request', "kind must be 'html', 'svg', or 'markdown'");
}

function asPermission(v: unknown): Permission {
  if (v === 'read' || v === 'write') return v;
  throw new AppError(400, 'bad_request', "permission must be 'read' or 'write'");
}

function artifactDto(
  a: Artifact,
  opts: { access?: Access; includeContent?: boolean; shareCount?: number } = {},
) {
  return {
    id: a.id,
    slug: a.slug,
    name: a.name,
    kind: a.kind,
    visibility: a.visibility,
    currentVersion: a.current_version,
    ownerId: a.owner_id,
    createdAt: a.created_at,
    updatedAt: a.updated_at,
    url: renderUrl(a.slug),
    ...(opts.access ? { access: opts.access } : {}),
    ...(opts.shareCount !== undefined ? { shareCount: opts.shareCount } : {}),
    ...(opts.includeContent ? { content: a.content } : {}),
  };
}

const lockDto = (lock: Lock) => ({
  holderId: lock.holder_id,
  holderKind: lock.holder_kind,
  acquiredAt: lock.acquired_at,
  expiresAt: lock.expires_at,
});

type Need = 'view' | 'edit' | 'owner';

/** Load an artifact and assert the caller's access, or throw 401/403/404. */
function loadForUser(
  c: Context,
  id: string,
  need: Need,
): { userId: string; artifact: Artifact; access: Access } {
  const { user } = requireAuth(c);
  const artifact = getArtifactById(id);
  if (!artifact) throw notFound('artifact not found');
  const access = artifactAccess(artifact, user.id);
  if (access === null) throw forbidden();
  if (need === 'edit' && !canEdit(access)) throw forbidden();
  if (need === 'owner' && !isOwner(access)) throw forbidden();
  if (need === 'view' && !canView(access)) throw forbidden();
  return { userId: user.id, artifact, access };
}

// --- Collection ---
artifactApiRoutes.get('/', (c) => {
  const { user } = requireAuth(c);
  const artifacts = listArtifactsForUser(user.id).map((a) =>
    artifactDto(a, { access: artifactAccess(a, user.id) ?? undefined, shareCount: a.share_count }),
  );
  return c.json({ artifacts });
});

artifactApiRoutes.post('/', async (c) => {
  const { user } = requireAuth(c);
  const body = await readBody(c);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) throw new AppError(400, 'bad_request', 'name is required');
  const artifact = createArtifact({
    ownerId: user.id,
    name,
    kind: asKind(body.kind),
    content: typeof body.content === 'string' ? body.content : '',
    editorId: user.id,
    editorKind: 'user',
  });
  recordAudit({
    actorId: user.id,
    actorKind: 'user',
    action: 'artifact.create',
    resourceKind: 'artifact',
    resourceId: artifact.id,
  });
  return c.json(
    { artifact: artifactDto(artifact, { access: 'owner', includeContent: true }) },
    201,
  );
});

// Render unsaved editor content in isolation (spec §13 live preview).
artifactApiRoutes.post('/preview', async (c) => {
  requireAuth(c);
  const body = await readBody(c);
  const content = typeof body.content === 'string' ? body.content : '';
  return c.json({ html: renderArtifactHtml(asKind(body.kind), content) });
});

// --- Item ---
artifactApiRoutes.get('/:id', (c) => {
  const { artifact, access } = loadForUser(c, c.req.param('id'), 'view');
  const lock = getActiveLock('artifact', artifact.id);
  return c.json({
    artifact: artifactDto(artifact, { access, includeContent: true }),
    lock: lock ? lockDto(lock) : null,
  });
});

artifactApiRoutes.patch('/:id', async (c) => {
  const { userId, artifact } = loadForUser(c, c.req.param('id'), 'edit');
  const body = await readBody(c);
  const baseVersion = Number(body.baseVersion);
  if (!Number.isInteger(baseVersion)) {
    throw new AppError(400, 'bad_request', 'baseVersion (integer) is required');
  }
  // A lock held by someone else blocks the write (spec §8); the optimistic
  // base-version check in updateArtifact is the second line of defense.
  const lock = getActiveLock('artifact', artifact.id);
  if (lock && lock.holder_id !== userId) {
    throw conflict(
      `locked by another editor until ${new Date(lock.expires_at * 1000).toISOString()}`,
    );
  }
  const updated = updateArtifact({
    artifactId: artifact.id,
    baseVersion,
    content: typeof body.content === 'string' ? body.content : undefined,
    name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : undefined,
    kind: body.kind !== undefined ? asKind(body.kind) : undefined,
    editorId: userId,
    editorKind: 'user',
    note: typeof body.note === 'string' ? body.note : null,
  });
  recordAudit({
    actorId: userId,
    actorKind: 'user',
    action: 'artifact.update',
    resourceKind: 'artifact',
    resourceId: artifact.id,
    detail: { version: updated.current_version },
  });
  return c.json({
    artifact: artifactDto(updated, {
      access: artifactAccess(updated, userId) ?? undefined,
      includeContent: true,
    }),
  });
});

artifactApiRoutes.delete('/:id', (c) => {
  const { userId, artifact } = loadForUser(c, c.req.param('id'), 'owner');
  deleteArtifact(artifact.id);
  recordAudit({
    actorId: userId,
    actorKind: 'user',
    action: 'artifact.delete',
    resourceKind: 'artifact',
    resourceId: artifact.id,
  });
  return c.json({ ok: true });
});

artifactApiRoutes.get('/:id/versions', (c) => {
  const { artifact } = loadForUser(c, c.req.param('id'), 'view');
  const versions = listArtifactVersions(artifact.id).map((v) => ({
    version: v.version,
    editorKind: v.editor_kind,
    note: v.note,
    createdAt: v.created_at,
  }));
  return c.json({ versions });
});

artifactApiRoutes.put('/:id/visibility', async (c) => {
  const { userId, artifact } = loadForUser(c, c.req.param('id'), 'owner');
  const body = await readBody(c);
  if (body.visibility !== 'public' && body.visibility !== 'private') {
    throw new AppError(400, 'bad_request', "visibility must be 'public' or 'private'");
  }
  const updated = setArtifactVisibility(artifact.id, body.visibility, userId);
  recordAudit({
    actorId: userId,
    actorKind: 'user',
    action: 'artifact.visibility',
    resourceKind: 'artifact',
    resourceId: artifact.id,
    detail: { visibility: body.visibility },
  });
  return c.json({ artifact: artifactDto(updated, { access: 'owner', includeContent: true }) });
});

// --- Lock (spec §8) ---
artifactApiRoutes.post('/:id/lock', (c) => {
  const { userId, artifact } = loadForUser(c, c.req.param('id'), 'edit');
  const lock = acquireLock({
    resourceKind: 'artifact',
    resourceId: artifact.id,
    holderId: userId,
    holderKind: 'user',
  });
  return c.json({ lock: lockDto(lock) });
});

artifactApiRoutes.delete('/:id/lock', (c) => {
  const { userId, artifact, access } = loadForUser(c, c.req.param('id'), 'edit');
  releaseLock('artifact', artifact.id, userId, { force: isOwner(access) });
  return c.json({ ok: true });
});

// --- Sharing (spec §8) — owner only ---
artifactApiRoutes.get('/:id/shares', (c) => {
  const { artifact } = loadForUser(c, c.req.param('id'), 'owner');
  return c.json({ shares: listSharesWithGrantee('artifact', artifact.id) });
});

artifactApiRoutes.post('/:id/shares', async (c) => {
  const { userId, artifact } = loadForUser(c, c.req.param('id'), 'owner');
  const body = await readBody(c);
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email) throw new AppError(400, 'bad_request', 'email is required');
  const permission = asPermission(body.permission);
  const grantee = getUserByEmail(email);
  if (!grantee) throw notFound('no user with that email');
  if (grantee.id === artifact.owner_id) {
    throw new AppError(400, 'bad_request', 'the owner already has full access');
  }
  setShare('artifact', artifact.id, grantee.id, permission, userId);
  recordAudit({
    actorId: userId,
    actorKind: 'user',
    action: 'artifact.share',
    resourceKind: 'artifact',
    resourceId: artifact.id,
    detail: { grantee: grantee.id, permission },
  });
  return c.json({ shares: listSharesWithGrantee('artifact', artifact.id) }, 201);
});

artifactApiRoutes.delete('/:id/shares/:granteeId', (c) => {
  const { userId, artifact } = loadForUser(c, c.req.param('id'), 'owner');
  const granteeId = c.req.param('granteeId');
  if (!removeShare('artifact', artifact.id, granteeId)) throw notFound('share not found');
  recordAudit({
    actorId: userId,
    actorKind: 'user',
    action: 'artifact.unshare',
    resourceKind: 'artifact',
    resourceId: artifact.id,
    detail: { grantee: granteeId },
  });
  return c.json({ shares: listSharesWithGrantee('artifact', artifact.id) });
});
