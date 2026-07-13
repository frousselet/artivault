import { getDb } from '../db/index.js';
import type { ResourceKind, Share } from '../types/domain.js';

/** All share grants on a resource (spec §8). */
export function listSharesFor(kind: ResourceKind, id: string): Share[] {
  return getDb()
    .prepare('SELECT * FROM shares WHERE resource_kind = ? AND resource_id = ?')
    .all(kind, id) as Share[];
}

// TODO(spec §7, §8): permission resolution and mutation —
//   - effectivePermission(kind, resourceId, userId): 'owner' | 'write' | 'read' | null,
//     propagating an artifact's grants to its linked datasets
//   - share / changeLevel / unshare (owner only)
// The management API and MCP tools both build on this.
