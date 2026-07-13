import { File } from 'node:buffer';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { requireAuth } from '../../auth/session.js';
import { config } from '../../config/env.js';
import { recordAudit } from '../../services/audit.js';
import {
  type Access,
  canEdit,
  canView,
  datasetAccess,
  isOwner,
} from '../../services/authorization.js';
import {
  createInlineDataset,
  createSqliteDataset,
  deleteDataset,
  deleteDatasetVersion,
  getDatasetById,
  listDatasetsForUser,
  listDatasetVersions,
  queryDataset,
  replaceSqliteFile,
  restoreDatasetVersion,
  updateInlineDataset,
} from '../../services/datasets.js';
import { listSharesWithGrantee, removeShare, setShare } from '../../services/shares.js';
import { getUserByEmail } from '../../services/users.js';
import type { Dataset } from '../../types/domain.js';
import { AppError, forbidden, notFound } from '../../util/http.js';

export const datasetApiRoutes = new Hono();

const base = config.PUBLIC_BASE_URL.replace(/\/+$/, '');

async function readBody(c: Context): Promise<Record<string, unknown>> {
  return (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
}

function asPermission(v: unknown): 'read' | 'write' {
  if (v === 'read' || v === 'write') return v;
  throw new AppError(400, 'bad_request', "permission must be 'read' or 'write'");
}

function datasetDto(
  d: Dataset,
  opts: { access?: Access; includeContent?: boolean; shareCount?: number } = {},
) {
  return {
    id: d.id,
    slug: d.slug,
    name: d.name,
    storage: d.storage,
    format: d.format,
    currentVersion: d.current_version,
    ownerId: d.owner_id,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
    url: `${base}/api/datasets/${d.id}`,
    ...(opts.access ? { access: opts.access } : {}),
    ...(opts.shareCount !== undefined ? { shareCount: opts.shareCount } : {}),
    ...(opts.includeContent && d.storage === 'inline' ? { content: d.content ?? '' } : {}),
  };
}

type Need = 'view' | 'edit' | 'owner';
function loadForUser(
  c: Context,
  id: string,
  need: Need,
): { userId: string; dataset: Dataset; access: Access } {
  const { user } = requireAuth(c);
  const dataset = getDatasetById(id);
  if (!dataset) throw notFound('dataset not found');
  const access = datasetAccess(dataset, user.id);
  if (access === null) throw forbidden();
  if (need === 'edit' && !canEdit(access)) throw forbidden();
  if (need === 'owner' && !isOwner(access)) throw forbidden();
  if (need === 'view' && !canView(access)) throw forbidden();
  return { userId: user.id, dataset, access };
}

// --- Collection ---
datasetApiRoutes.get('/', (c) => {
  const { user } = requireAuth(c);
  const datasets = listDatasetsForUser(user.id).map((d) =>
    datasetDto(d, { access: datasetAccess(d, user.id) ?? undefined, shareCount: d.share_count }),
  );
  return c.json({ datasets });
});

datasetApiRoutes.post('/', async (c) => {
  const { user } = requireAuth(c);

  // multipart → SQLite-file upload; JSON → inline CSV/JSON.
  if ((c.req.header('content-type') ?? '').includes('multipart/form-data')) {
    const body = await c.req.parseBody();
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) throw new AppError(400, 'bad_request', 'name is required');
    const file = body.file;
    if (!(file instanceof File))
      throw new AppError(400, 'bad_request', 'a SQLite file is required');
    const data = Buffer.from(await file.arrayBuffer());
    const dataset = createSqliteDataset({
      ownerId: user.id,
      name,
      data,
      editorId: user.id,
      editorKind: 'user',
    });
    recordAudit({
      actorId: user.id,
      actorKind: 'user',
      action: 'dataset.create',
      resourceKind: 'dataset',
      resourceId: dataset.id,
    });
    return c.json({ dataset: datasetDto(dataset, { access: 'owner' }) }, 201);
  }

  const body = await readBody(c);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) throw new AppError(400, 'bad_request', 'name is required');
  if (body.format !== 'csv' && body.format !== 'json') {
    throw new AppError(400, 'bad_request', "format must be 'csv' or 'json'");
  }
  const dataset = createInlineDataset({
    ownerId: user.id,
    name,
    format: body.format,
    content: typeof body.content === 'string' ? body.content : '',
    editorId: user.id,
    editorKind: 'user',
  });
  recordAudit({
    actorId: user.id,
    actorKind: 'user',
    action: 'dataset.create',
    resourceKind: 'dataset',
    resourceId: dataset.id,
  });
  return c.json({ dataset: datasetDto(dataset, { access: 'owner', includeContent: true }) }, 201);
});

// --- Item ---
datasetApiRoutes.get('/:id', (c) => {
  const { dataset, access } = loadForUser(c, c.req.param('id'), 'view');
  return c.json({ dataset: datasetDto(dataset, { access, includeContent: true }) });
});

datasetApiRoutes.patch('/:id', async (c) => {
  const { userId, dataset } = loadForUser(c, c.req.param('id'), 'edit');
  const body = await readBody(c);
  const baseVersion = Number(body.baseVersion);
  if (!Number.isInteger(baseVersion)) {
    throw new AppError(400, 'bad_request', 'baseVersion (integer) is required');
  }
  if (typeof body.content !== 'string') {
    throw new AppError(400, 'bad_request', 'content is required for an inline dataset');
  }
  const updated = updateInlineDataset({
    datasetId: dataset.id,
    baseVersion,
    content: body.content,
    name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : undefined,
    editorId: userId,
    editorKind: 'user',
  });
  recordAudit({
    actorId: userId,
    actorKind: 'user',
    action: 'dataset.update',
    resourceKind: 'dataset',
    resourceId: dataset.id,
    detail: { version: updated.current_version },
  });
  return c.json({ dataset: datasetDto(updated, { access: 'owner', includeContent: true }) });
});

// Replace the SQLite file (new version).
datasetApiRoutes.post('/:id/content', async (c) => {
  const { userId, dataset } = loadForUser(c, c.req.param('id'), 'edit');
  const body = await c.req.parseBody();
  const file = body.file;
  if (!(file instanceof File)) throw new AppError(400, 'bad_request', 'a SQLite file is required');
  const baseVersion = Number(body.baseVersion ?? dataset.current_version);
  const updated = replaceSqliteFile({
    datasetId: dataset.id,
    baseVersion,
    data: Buffer.from(await file.arrayBuffer()),
    editorId: userId,
    editorKind: 'user',
  });
  recordAudit({
    actorId: userId,
    actorKind: 'user',
    action: 'dataset.update',
    resourceKind: 'dataset',
    resourceId: dataset.id,
    detail: { version: updated.current_version },
  });
  return c.json({ dataset: datasetDto(updated, { access: 'owner' }) });
});

datasetApiRoutes.delete('/:id', (c) => {
  const { userId, dataset } = loadForUser(c, c.req.param('id'), 'owner');
  deleteDataset(dataset.id);
  recordAudit({
    actorId: userId,
    actorKind: 'user',
    action: 'dataset.delete',
    resourceKind: 'dataset',
    resourceId: dataset.id,
  });
  return c.json({ ok: true });
});

// Read-only SQL query (SQLite datasets, spec §12).
datasetApiRoutes.post('/:id/query', async (c) => {
  const { dataset } = loadForUser(c, c.req.param('id'), 'view');
  const body = await readBody(c);
  const sql = typeof body.sql === 'string' ? body.sql : '';
  if (!sql.trim()) throw new AppError(400, 'bad_request', 'sql is required');
  return c.json(queryDataset(dataset, sql));
});

// --- Versions (spec §9) ---
datasetApiRoutes.get('/:id/versions', (c) => {
  const { dataset } = loadForUser(c, c.req.param('id'), 'view');
  const versions = listDatasetVersions(dataset.id).map((v) => ({
    version: v.version,
    editorKind: v.editor_kind,
    note: v.note,
    createdAt: v.created_at,
  }));
  return c.json({ versions });
});

datasetApiRoutes.post('/:id/versions/:v/restore', (c) => {
  const { userId, dataset } = loadForUser(c, c.req.param('id'), 'edit');
  const version = Number(c.req.param('v'));
  const updated = restoreDatasetVersion({
    datasetId: dataset.id,
    version,
    editorId: userId,
    editorKind: 'user',
  });
  recordAudit({
    actorId: userId,
    actorKind: 'user',
    action: 'dataset.restore',
    resourceKind: 'dataset',
    resourceId: dataset.id,
    detail: { from: version, to: updated.current_version },
  });
  return c.json({ dataset: datasetDto(updated, { access: 'owner', includeContent: true }) });
});

datasetApiRoutes.delete('/:id/versions/:v', (c) => {
  const { userId, dataset } = loadForUser(c, c.req.param('id'), 'edit');
  deleteDatasetVersion(dataset.id, Number(c.req.param('v')));
  recordAudit({
    actorId: userId,
    actorKind: 'user',
    action: 'dataset.version.delete',
    resourceKind: 'dataset',
    resourceId: dataset.id,
    detail: { version: Number(c.req.param('v')) },
  });
  return c.json({ ok: true });
});

// --- Sharing (spec §8) — owner only ---
datasetApiRoutes.get('/:id/shares', (c) => {
  const { dataset } = loadForUser(c, c.req.param('id'), 'owner');
  return c.json({ shares: listSharesWithGrantee('dataset', dataset.id) });
});

datasetApiRoutes.post('/:id/shares', async (c) => {
  const { userId, dataset } = loadForUser(c, c.req.param('id'), 'owner');
  const body = await readBody(c);
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email) throw new AppError(400, 'bad_request', 'email is required');
  const permission = asPermission(body.permission);
  const grantee = getUserByEmail(email);
  if (!grantee) throw notFound('no user with that email');
  if (grantee.id === dataset.owner_id) {
    throw new AppError(400, 'bad_request', 'the owner already has full access');
  }
  setShare('dataset', dataset.id, grantee.id, permission, userId);
  recordAudit({
    actorId: userId,
    actorKind: 'user',
    action: 'dataset.share',
    resourceKind: 'dataset',
    resourceId: dataset.id,
    detail: { grantee: grantee.id, permission },
  });
  return c.json({ shares: listSharesWithGrantee('dataset', dataset.id) }, 201);
});

datasetApiRoutes.delete('/:id/shares/:granteeId', (c) => {
  const { userId, dataset } = loadForUser(c, c.req.param('id'), 'owner');
  const granteeId = c.req.param('granteeId');
  if (!removeShare('dataset', dataset.id, granteeId)) throw notFound('share not found');
  recordAudit({
    actorId: userId,
    actorKind: 'user',
    action: 'dataset.unshare',
    resourceKind: 'dataset',
    resourceId: dataset.id,
    detail: { grantee: granteeId },
  });
  return c.json({ shares: listSharesWithGrantee('dataset', dataset.id) });
});
