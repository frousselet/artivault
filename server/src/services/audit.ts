import { getDb } from '../db/index.js';
import type { ActorKind, ResourceKind } from '../types/domain.js';

export interface AuditInput {
  actorId: string | null;
  actorKind: ActorKind;
  action: string;
  resourceKind?: ResourceKind | null;
  resourceId?: string | null;
  ip?: string | null;
  detail?: unknown;
}

/** Append an entry to the audit log (spec §6, §14). `detail` is JSON-encoded. */
export function recordAudit(input: AuditInput): void {
  getDb()
    .prepare(
      `INSERT INTO audit_log (actor_id, actor_kind, action, resource_kind, resource_id, ip, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.actorId,
      input.actorKind,
      input.action,
      input.resourceKind ?? null,
      input.resourceId ?? null,
      input.ip ?? null,
      input.detail === undefined ? null : JSON.stringify(input.detail),
    );
}
