import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { config } from '../config/env.js';
import {
  type ArtifactWithShareCount,
  createArtifact,
  deleteArtifact,
  getArtifactById,
  listArtifactsForUser,
  listArtifactVersions,
  setArtifactVisibility,
  updateArtifact,
} from '../services/artifacts.js';
import { recordAudit } from '../services/audit.js';
import {
  artifactAccess,
  canEdit,
  canView,
  datasetAccess,
  isOwner,
} from '../services/authorization.js';
import {
  createInlineDataset,
  deleteDataset,
  deleteDatasetVersion,
  getDatasetById,
  linkDataset,
  listDatasetsForUser,
  listDatasetVersions,
  queryDataset,
  restoreDatasetVersion,
  unlinkDataset,
  updateInlineDataset,
} from '../services/datasets.js';
import { acquireLock, getActiveLock, releaseLock } from '../services/locks.js';
import { listSharesWithGrantee, removeShare, setShare } from '../services/shares.js';
import { getUserByEmail } from '../services/users.js';
import type { Artifact, Dataset, User } from '../types/domain.js';
import { AppError } from '../util/http.js';

const base = config.PUBLIC_BASE_URL.replace(/\/+$/, '');
const renderUrl = (slug: string) => `${base}/artifact/${slug}`;

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };
const ok = (data: unknown): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
});
const fail = (message: string): ToolResult => ({
  content: [{ type: 'text', text: `Error: ${message}` }],
  isError: true,
});
const run = async (fn: () => unknown | Promise<unknown>): Promise<ToolResult> => {
  try {
    return ok(await fn());
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
};

const summary = (a: Artifact) => ({
  id: a.id,
  slug: a.slug,
  name: a.name,
  kind: a.kind,
  visibility: a.visibility,
  currentVersion: a.current_version,
  url: renderUrl(a.slug),
});

/**
 * Build an MCP server whose tools act as `user` — the account bound to the OAuth
 * token (spec §14). Every write records an audit entry with actor_kind = 'agent'.
 */
export function buildMcpServer(user: User): McpServer {
  const server = new McpServer({ name: 'artivault', version: '0.0.0' });

  const load = (id: string, need: 'view' | 'edit' | 'owner') => {
    const a = getArtifactById(id);
    if (!a) throw new AppError(404, 'not_found', 'artifact not found');
    const access = artifactAccess(a, user.id);
    if (access === null || (need === 'view' && !canView(access))) {
      throw new AppError(403, 'forbidden', 'no access to this artifact');
    }
    if (need === 'edit' && !canEdit(access)) {
      throw new AppError(403, 'forbidden', 'write access required');
    }
    if (need === 'owner' && !isOwner(access)) {
      throw new AppError(403, 'forbidden', 'owner-only action');
    }
    return { a, access };
  };

  const audit = (action: string, resourceId: string, detail?: unknown): void =>
    recordAudit({
      actorId: user.id,
      actorKind: 'agent',
      action,
      resourceKind: 'artifact',
      resourceId,
      detail,
    });

  server.registerTool(
    'list_artifacts',
    { description: 'List artifacts owned by or shared with you.', inputSchema: {} },
    () =>
      run(() => ({
        artifacts: listArtifactsForUser(user.id).map((a: ArtifactWithShareCount) => ({
          ...summary(a),
          shareCount: a.share_count,
        })),
      })),
  );

  server.registerTool(
    'get_artifact',
    {
      description: 'Get an artifact including content, render URL, version and lock state.',
      inputSchema: { id: z.string() },
    },
    ({ id }) =>
      run(() => {
        const { a, access } = load(id, 'view');
        const lock = getActiveLock('artifact', a.id);
        return {
          ...summary(a),
          content: a.content,
          access,
          lock: lock ? { holderId: lock.holder_id, expiresAt: lock.expires_at } : null,
        };
      }),
  );

  server.registerTool(
    'create_artifact',
    {
      description: 'Create an artifact (html, svg, or markdown). Returns its render URL.',
      inputSchema: {
        name: z.string(),
        kind: z.enum(['html', 'svg', 'markdown']),
        content: z.string().default(''),
      },
    },
    ({ name, kind, content }) =>
      run(() => {
        const a = createArtifact({
          ownerId: user.id,
          name,
          kind,
          content,
          editorId: user.id,
          editorKind: 'agent',
        });
        audit('artifact.create', a.id);
        return summary(a);
      }),
  );

  server.registerTool(
    'update_artifact',
    {
      description:
        'Update an artifact. Pass baseVersion (the current version) so a stale write is rejected.',
      inputSchema: {
        id: z.string(),
        baseVersion: z.number().int(),
        content: z.string().optional(),
        name: z.string().optional(),
        kind: z.enum(['html', 'svg', 'markdown']).optional(),
        note: z.string().optional(),
      },
    },
    ({ id, baseVersion, content, name, kind, note }) =>
      run(() => {
        const { a } = load(id, 'edit');
        const lock = getActiveLock('artifact', a.id);
        if (lock && lock.holder_id !== user.id) {
          throw new AppError(409, 'conflict', 'locked by another editor');
        }
        const updated = updateArtifact({
          artifactId: a.id,
          baseVersion,
          content,
          name,
          kind,
          editorId: user.id,
          editorKind: 'agent',
          note: note ?? null,
        });
        audit('artifact.update', a.id, { version: updated.current_version });
        return summary(updated);
      }),
  );

  server.registerTool(
    'set_artifact_visibility',
    {
      description: 'Make an artifact public or private.',
      inputSchema: { id: z.string(), visibility: z.enum(['public', 'private']) },
    },
    ({ id, visibility }) =>
      run(() => {
        const { a } = load(id, 'owner');
        const updated = setArtifactVisibility(a.id, visibility, user.id);
        audit('artifact.visibility', a.id, { visibility });
        return summary(updated);
      }),
  );

  server.registerTool(
    'delete_artifact',
    { description: 'Delete an artifact.', inputSchema: { id: z.string() } },
    ({ id }) =>
      run(() => {
        const { a } = load(id, 'owner');
        deleteArtifact(a.id);
        audit('artifact.delete', a.id);
        return { ok: true };
      }),
  );

  server.registerTool(
    'list_artifact_versions',
    { description: "List an artifact's version history.", inputSchema: { id: z.string() } },
    ({ id }) =>
      run(() => {
        const { a } = load(id, 'view');
        return {
          versions: listArtifactVersions(a.id).map((v) => ({
            version: v.version,
            editorKind: v.editor_kind,
            note: v.note,
            createdAt: v.created_at,
          })),
        };
      }),
  );

  server.registerTool(
    'share_artifact',
    {
      description: 'Share an artifact with a user (by email) as read or write.',
      inputSchema: { id: z.string(), email: z.string(), permission: z.enum(['read', 'write']) },
    },
    ({ id, email, permission }) =>
      run(() => {
        const { a } = load(id, 'owner');
        const grantee = getUserByEmail(email.trim().toLowerCase());
        if (!grantee) throw new AppError(404, 'not_found', 'no user with that email');
        if (grantee.id === a.owner_id) {
          throw new AppError(400, 'bad_request', 'the owner already has access');
        }
        setShare('artifact', a.id, grantee.id, permission, user.id);
        audit('artifact.share', a.id, { grantee: grantee.id, permission });
        return { shares: listSharesWithGrantee('artifact', a.id) };
      }),
  );

  server.registerTool(
    'unshare_artifact',
    {
      description: "Revoke a user's access to an artifact (by email).",
      inputSchema: { id: z.string(), email: z.string() },
    },
    ({ id, email }) =>
      run(() => {
        const { a } = load(id, 'owner');
        const grantee = getUserByEmail(email.trim().toLowerCase());
        if (!grantee || !removeShare('artifact', a.id, grantee.id)) {
          throw new AppError(404, 'not_found', 'share not found');
        }
        audit('artifact.unshare', a.id, { grantee: grantee.id });
        return { shares: listSharesWithGrantee('artifact', a.id) };
      }),
  );

  server.registerTool(
    'acquire_lock',
    { description: 'Acquire the edit lock on an artifact.', inputSchema: { id: z.string() } },
    ({ id }) =>
      run(() => {
        const { a } = load(id, 'edit');
        const lock = acquireLock({
          resourceKind: 'artifact',
          resourceId: a.id,
          holderId: user.id,
          holderKind: 'agent',
        });
        return { holderId: lock.holder_id, expiresAt: lock.expires_at };
      }),
  );

  server.registerTool(
    'release_lock',
    { description: 'Release the edit lock on an artifact.', inputSchema: { id: z.string() } },
    ({ id }) =>
      run(() => {
        const { a, access } = load(id, 'edit');
        releaseLock('artifact', a.id, user.id, { force: isOwner(access) });
        return { ok: true };
      }),
  );

  // --- Datasets (spec §12) ---
  const datasetSummary = (d: Dataset) => ({
    id: d.id,
    slug: d.slug,
    name: d.name,
    storage: d.storage,
    format: d.format,
    currentVersion: d.current_version,
  });
  const loadDataset = (id: string, need: 'view' | 'edit' | 'owner') => {
    const d = getDatasetById(id);
    if (!d) throw new AppError(404, 'not_found', 'dataset not found');
    const access = datasetAccess(d, user.id);
    if (access === null || (need === 'view' && !canView(access))) {
      throw new AppError(403, 'forbidden', 'no access to this dataset');
    }
    if (need === 'edit' && !canEdit(access)) {
      throw new AppError(403, 'forbidden', 'write access required');
    }
    if (need === 'owner' && !isOwner(access)) {
      throw new AppError(403, 'forbidden', 'owner-only action');
    }
    return { d, access };
  };
  const auditDs = (action: string, resourceId: string, detail?: unknown): void =>
    recordAudit({
      actorId: user.id,
      actorKind: 'agent',
      action,
      resourceKind: 'dataset',
      resourceId,
      detail,
    });

  server.registerTool(
    'list_datasets',
    { description: 'List datasets owned by or shared with you.', inputSchema: {} },
    () => run(() => ({ datasets: listDatasetsForUser(user.id).map(datasetSummary) })),
  );

  server.registerTool(
    'get_dataset',
    {
      description: 'Get a dataset. Inline datasets include their content.',
      inputSchema: { id: z.string() },
    },
    ({ id }) =>
      run(() => {
        const { d, access } = loadDataset(id, 'view');
        return {
          ...datasetSummary(d),
          access,
          ...(d.storage === 'inline' ? { content: d.content ?? '' } : {}),
        };
      }),
  );

  server.registerTool(
    'create_dataset',
    {
      description: 'Create an inline CSV or JSON dataset.',
      inputSchema: {
        name: z.string(),
        format: z.enum(['csv', 'json']),
        content: z.string().default(''),
      },
    },
    ({ name, format, content }) =>
      run(() => {
        const d = createInlineDataset({
          ownerId: user.id,
          name,
          format,
          content,
          editorId: user.id,
          editorKind: 'agent',
        });
        auditDs('dataset.create', d.id);
        return datasetSummary(d);
      }),
  );

  server.registerTool(
    'update_dataset',
    {
      description: 'Update an inline dataset (pass baseVersion for a safe write).',
      inputSchema: {
        id: z.string(),
        baseVersion: z.number().int(),
        content: z.string(),
        name: z.string().optional(),
      },
    },
    ({ id, baseVersion, content, name }) =>
      run(() => {
        const { d } = loadDataset(id, 'edit');
        const updated = updateInlineDataset({
          datasetId: d.id,
          baseVersion,
          content,
          name,
          editorId: user.id,
          editorKind: 'agent',
        });
        auditDs('dataset.update', d.id, { version: updated.current_version });
        return datasetSummary(updated);
      }),
  );

  server.registerTool(
    'delete_dataset',
    { description: 'Delete a dataset.', inputSchema: { id: z.string() } },
    ({ id }) =>
      run(() => {
        const { d } = loadDataset(id, 'owner');
        deleteDataset(d.id);
        auditDs('dataset.delete', d.id);
        return { ok: true };
      }),
  );

  server.registerTool(
    'query_dataset',
    {
      description: 'Run a read-only SELECT against a SQLite-file dataset.',
      inputSchema: { id: z.string(), sql: z.string() },
    },
    ({ id, sql }) =>
      run(() => {
        const { d } = loadDataset(id, 'view');
        return queryDataset(d, sql);
      }),
  );

  server.registerTool(
    'list_dataset_versions',
    { description: "List a dataset's version history.", inputSchema: { id: z.string() } },
    ({ id }) =>
      run(() => {
        const { d } = loadDataset(id, 'view');
        return {
          versions: listDatasetVersions(d.id).map((v) => ({
            version: v.version,
            editorKind: v.editor_kind,
            note: v.note,
            createdAt: v.created_at,
          })),
        };
      }),
  );

  server.registerTool(
    'restore_dataset_version',
    {
      description: 'Promote a past dataset version to a new head.',
      inputSchema: { id: z.string(), version: z.number().int() },
    },
    ({ id, version }) =>
      run(() => {
        const { d } = loadDataset(id, 'edit');
        const updated = restoreDatasetVersion({
          datasetId: d.id,
          version,
          editorId: user.id,
          editorKind: 'agent',
        });
        auditDs('dataset.restore', d.id, { from: version, to: updated.current_version });
        return datasetSummary(updated);
      }),
  );

  server.registerTool(
    'delete_dataset_version',
    {
      description: 'Delete a single non-head dataset version.',
      inputSchema: { id: z.string(), version: z.number().int() },
    },
    ({ id, version }) =>
      run(() => {
        const { d } = loadDataset(id, 'edit');
        deleteDatasetVersion(d.id, version);
        auditDs('dataset.version.delete', d.id, { version });
        return { ok: true };
      }),
  );

  server.registerTool(
    'link_dataset',
    {
      description: 'Link a dataset to an artifact.',
      inputSchema: { artifactId: z.string(), datasetId: z.string() },
    },
    ({ artifactId, datasetId }) =>
      run(() => {
        const { a } = load(artifactId, 'edit');
        const { d } = loadDataset(datasetId, 'view');
        linkDataset(a.id, d.id);
        audit('artifact.link_dataset', a.id, { dataset: d.id });
        return { ok: true };
      }),
  );

  server.registerTool(
    'unlink_dataset',
    {
      description: 'Unlink a dataset from an artifact.',
      inputSchema: { artifactId: z.string(), datasetId: z.string() },
    },
    ({ artifactId, datasetId }) =>
      run(() => {
        const { a } = load(artifactId, 'edit');
        if (!unlinkDataset(a.id, datasetId)) throw new AppError(404, 'not_found', 'link not found');
        audit('artifact.unlink_dataset', a.id, { dataset: datasetId });
        return { ok: true };
      }),
  );

  server.registerTool(
    'share_dataset',
    {
      description: 'Share a dataset with a user (by email) as read or write.',
      inputSchema: { id: z.string(), email: z.string(), permission: z.enum(['read', 'write']) },
    },
    ({ id, email, permission }) =>
      run(() => {
        const { d } = loadDataset(id, 'owner');
        const grantee = getUserByEmail(email.trim().toLowerCase());
        if (!grantee) throw new AppError(404, 'not_found', 'no user with that email');
        if (grantee.id === d.owner_id) {
          throw new AppError(400, 'bad_request', 'the owner already has access');
        }
        setShare('dataset', d.id, grantee.id, permission, user.id);
        auditDs('dataset.share', d.id, { grantee: grantee.id, permission });
        return { shares: listSharesWithGrantee('dataset', d.id) };
      }),
  );

  server.registerTool(
    'unshare_dataset',
    {
      description: "Revoke a user's access to a dataset (by email).",
      inputSchema: { id: z.string(), email: z.string() },
    },
    ({ id, email }) =>
      run(() => {
        const { d } = loadDataset(id, 'owner');
        const grantee = getUserByEmail(email.trim().toLowerCase());
        if (!grantee || !removeShare('dataset', d.id, grantee.id)) {
          throw new AppError(404, 'not_found', 'share not found');
        }
        auditDs('dataset.unshare', d.id, { grantee: grantee.id });
        return { shares: listSharesWithGrantee('dataset', d.id) };
      }),
  );

  return server;
}
