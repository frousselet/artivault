import { getDb } from '../db/index.js';
import type { Artifact, Permission, ResourceKind } from '../types/domain.js';

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
