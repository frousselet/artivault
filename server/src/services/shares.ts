import { getDb } from '../db/index.js';
import type { Permission, ResourceKind, Share } from '../types/domain.js';

/** All share grants on a resource (spec §8). */
export function listSharesFor(kind: ResourceKind, id: string): Share[] {
  return getDb()
    .prepare('SELECT * FROM shares WHERE resource_kind = ? AND resource_id = ?')
    .all(kind, id) as Share[];
}

export function countSharesFor(kind: ResourceKind, id: string): number {
  return (
    getDb()
      .prepare('SELECT COUNT(*) AS n FROM shares WHERE resource_kind = ? AND resource_id = ?')
      .get(kind, id) as { n: number }
  ).n;
}

export interface ShareWithGrantee {
  granteeId: string;
  email: string;
  displayName: string;
  permission: Permission;
  createdAt: number;
}

/** Shares on a resource joined with the grantee's identity (spec §8, §13). */
export function listSharesWithGrantee(kind: ResourceKind, id: string): ShareWithGrantee[] {
  return getDb()
    .prepare(
      `SELECT s.grantee_id AS granteeId, u.email AS email, u.display_name AS displayName,
              s.permission AS permission, s.created_at AS createdAt
       FROM shares s
       JOIN users u ON u.id = s.grantee_id
       WHERE s.resource_kind = ? AND s.resource_id = ?
       ORDER BY u.email`,
    )
    .all(kind, id) as ShareWithGrantee[];
}

/** Grant or change a grantee's permission on a resource (owner action, spec §8). */
export function setShare(
  kind: ResourceKind,
  resourceId: string,
  granteeId: string,
  permission: Permission,
  createdBy: string,
): void {
  getDb()
    .prepare(
      `INSERT INTO shares (resource_kind, resource_id, grantee_id, permission, created_by)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (resource_kind, resource_id, grantee_id)
       DO UPDATE SET permission = excluded.permission`,
    )
    .run(kind, resourceId, granteeId, permission, createdBy);
}

/** Revoke a grantee's access. Returns whether a grant was removed. */
export function removeShare(kind: ResourceKind, resourceId: string, granteeId: string): boolean {
  return (
    getDb()
      .prepare('DELETE FROM shares WHERE resource_kind = ? AND resource_id = ? AND grantee_id = ?')
      .run(kind, resourceId, granteeId).changes > 0
  );
}
