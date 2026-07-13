import { config } from '../config/env.js';
import { getDb } from '../db/index.js';
import type { HolderKind, Lock, ResourceKind } from '../types/domain.js';
import { conflict, forbidden } from '../util/http.js';
import { nowSeconds } from '../util/time.js';

export interface LockRequest {
  resourceKind: ResourceKind;
  resourceId: string;
  holderId: string;
  holderKind: HolderKind;
  ttlSeconds?: number;
}

/** The current lock on a resource, or null if none is held or it has expired (spec §8). */
export function getActiveLock(kind: ResourceKind, id: string): Lock | null {
  const lock = getDb()
    .prepare('SELECT * FROM locks WHERE resource_kind = ? AND resource_id = ?')
    .get(kind, id) as Lock | undefined;
  if (!lock || lock.expires_at <= nowSeconds()) return null;
  return lock;
}

/**
 * Acquire (or re-acquire) the exclusive lock on a resource. Fails if another
 * holder currently holds a non-expired lock (spec §8).
 */
export function acquireLock(req: LockRequest): Lock {
  const ttl = req.ttlSeconds ?? config.LOCK_TTL_SECONDS;
  const db = getDb();
  const run = db.transaction((): Lock => {
    const now = nowSeconds();
    const existing = db
      .prepare('SELECT * FROM locks WHERE resource_kind = ? AND resource_id = ?')
      .get(req.resourceKind, req.resourceId) as Lock | undefined;

    if (existing && existing.expires_at > now && existing.holder_id !== req.holderId) {
      const until = new Date(existing.expires_at * 1000).toISOString();
      throw conflict(`resource is locked by ${existing.holder_id} until ${until}`);
    }

    const expires = now + ttl;
    if (existing) {
      db.prepare(
        `UPDATE locks SET holder_id = ?, holder_kind = ?, acquired_at = ?, expires_at = ?
         WHERE resource_kind = ? AND resource_id = ?`,
      ).run(req.holderId, req.holderKind, now, expires, req.resourceKind, req.resourceId);
    } else {
      db.prepare(
        `INSERT INTO locks (resource_kind, resource_id, holder_id, holder_kind, acquired_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(req.resourceKind, req.resourceId, req.holderId, req.holderKind, now, expires);
    }

    return db
      .prepare('SELECT * FROM locks WHERE resource_kind = ? AND resource_id = ?')
      .get(req.resourceKind, req.resourceId) as Lock;
  });
  return run();
}

/** Heartbeat: extend the lock's expiry. Only the current holder may refresh (spec §8). */
export function refreshLock(
  kind: ResourceKind,
  id: string,
  holderId: string,
  ttlSeconds?: number,
): Lock {
  const ttl = ttlSeconds ?? config.LOCK_TTL_SECONDS;
  const active = getActiveLock(kind, id);
  if (!active || active.holder_id !== holderId) {
    throw forbidden('you do not hold this lock');
  }
  getDb()
    .prepare('UPDATE locks SET expires_at = ? WHERE resource_kind = ? AND resource_id = ?')
    .run(nowSeconds() + ttl, kind, id);
  return getActiveLock(kind, id) as Lock;
}

/**
 * Release a lock. The holder may release their own; `force` allows the owner or
 * an admin to break a lock held by someone else (spec §8). Authorization for
 * `force` is decided by the caller.
 */
export function releaseLock(
  kind: ResourceKind,
  id: string,
  holderId: string,
  opts: { force?: boolean } = {},
): void {
  const db = getDb();
  if (opts.force) {
    db.prepare('DELETE FROM locks WHERE resource_kind = ? AND resource_id = ?').run(kind, id);
    return;
  }
  db.prepare('DELETE FROM locks WHERE resource_kind = ? AND resource_id = ? AND holder_id = ?').run(
    kind,
    id,
    holderId,
  );
}
