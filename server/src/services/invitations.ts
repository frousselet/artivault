import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { config } from '../config/env.js';
import { getDb } from '../db/index.js';
import type { Invitation } from '../types/domain.js';
import { nowSeconds } from '../util/time.js';

// Invitation links let an admin-provisioned account set up its first passkey.
// The token is the capability (not the email); it is stored hashed, single-use,
// and expiring.

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export interface NewInvitation {
  token: string;
  invitation: Invitation;
}

export function createInvitation(
  userId: string,
  createdBy: string,
  ttlSeconds: number = config.INVITATION_TTL_SECONDS,
): NewInvitation {
  const token = randomBytes(32).toString('base64url');
  const id = randomUUID();
  const now = nowSeconds();
  getDb()
    .prepare(
      `INSERT INTO invitations (id, user_id, token_hash, created_by, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, userId, hashToken(token), createdBy, now + ttlSeconds, now);
  return { token, invitation: getInvitationById(id) as Invitation };
}

export function getInvitationById(id: string): Invitation | null {
  return (
    (getDb().prepare('SELECT * FROM invitations WHERE id = ?').get(id) as Invitation | undefined) ??
    null
  );
}

export function isInvitationUsable(inv: Invitation): boolean {
  return inv.used_at === null && inv.expires_at > nowSeconds();
}

/** Resolve a token to a usable invitation, or null if unknown, used, or expired. */
export function findUsableInvitation(token: string): Invitation | null {
  const inv = getDb()
    .prepare('SELECT * FROM invitations WHERE token_hash = ?')
    .get(hashToken(token)) as Invitation | undefined;
  if (!inv || !isInvitationUsable(inv)) return null;
  return inv;
}

export function markInvitationUsed(id: string): void {
  getDb().prepare('UPDATE invitations SET used_at = ? WHERE id = ?').run(nowSeconds(), id);
}

export function buildInviteUrl(token: string): string {
  return `${config.PUBLIC_BASE_URL.replace(/\/+$/, '')}/invite/${token}`;
}
