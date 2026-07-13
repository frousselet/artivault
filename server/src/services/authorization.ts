import { getDb } from '../db/index.js';
import type { Artifact, Dataset, Permission, ResourceKind } from '../types/domain.js';
import { getArtifactsLinkingDataset } from './datasets.js';

// Content-access resolution (spec §7). Note: admin has NO implicit content
// access — administration only grants metadata listing and force-unlock.

export type Access = 'owner' | 'write' | 'read';

/** The share grant a user has on a resource, or null. */
export function shareFor(
  kind: ResourceKind,
  resourceId: string,
  userId: string,
): Permission | null {
  const row = getDb()
    .prepare(
      'SELECT permission FROM shares WHERE resource_kind = ? AND resource_id = ? AND grantee_id = ?',
    )
    .get(kind, resourceId, userId) as { permission: Permission } | undefined;
  return row?.permission ?? null;
}

/** A user's effective access to an artifact: owner, a share level, or none. */
export function artifactAccess(artifact: Artifact, userId: string): Access | null {
  if (artifact.owner_id === userId) return 'owner';
  return shareFor('artifact', artifact.id, userId);
}

export const canView = (access: Access | null): boolean => access !== null;
export const canEdit = (access: Access | null): boolean => access === 'owner' || access === 'write';
export const isOwner = (access: Access | null): boolean => access === 'owner';

const RANK: Record<Access, number> = { read: 1, write: 2, owner: 3 };
const maxAccess = (a: Access | null, b: Access | null): Access | null => {
  if (!a) return b;
  if (!b) return a;
  return RANK[a] >= RANK[b] ? a : b;
};

/**
 * A user's effective access to a dataset: direct ownership/share, plus any level
 * propagated from an artifact that links it (spec §8). Artifact owner/write →
 * dataset write; artifact read → dataset read.
 */
export function datasetAccess(dataset: Dataset, userId: string): Access | null {
  if (dataset.owner_id === userId) return 'owner';
  let best: Access | null = shareFor('dataset', dataset.id, userId);
  for (const artifact of getArtifactsLinkingDataset(dataset.id)) {
    const viaArtifact = artifactAccess(artifact, userId);
    if (viaArtifact) best = maxAccess(best, viaArtifact === 'read' ? 'read' : 'write');
  }
  return best;
}
