import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';
import type { Credential } from '../types/domain.js';
import { nowSeconds } from '../util/time.js';

export function listCredentialsByUser(userId: string): Credential[] {
  return getDb()
    .prepare('SELECT * FROM credentials WHERE user_id = ? ORDER BY created_at')
    .all(userId) as Credential[];
}

export function countCredentialsByUser(userId: string): number {
  return (
    getDb().prepare('SELECT COUNT(*) AS n FROM credentials WHERE user_id = ?').get(userId) as {
      n: number;
    }
  ).n;
}

export function getCredentialByCredentialId(credentialId: string): Credential | null {
  return (
    (getDb().prepare('SELECT * FROM credentials WHERE credential_id = ?').get(credentialId) as
      | Credential
      | undefined) ?? null
  );
}

export interface AddCredentialInput {
  userId: string;
  credentialId: string;
  publicKey: Uint8Array;
  counter: number;
  transports?: string[];
  deviceName?: string | null;
}

export function addCredential(input: AddCredentialInput): Credential {
  const db = getDb();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO credentials
       (id, user_id, credential_id, public_key, counter, transports, device_name, created_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
  ).run(
    id,
    input.userId,
    input.credentialId,
    Buffer.from(input.publicKey),
    input.counter,
    input.transports && input.transports.length > 0 ? JSON.stringify(input.transports) : null,
    input.deviceName ?? null,
    nowSeconds(),
  );
  return db.prepare('SELECT * FROM credentials WHERE id = ?').get(id) as Credential;
}

/** Advance the signature counter and mark the credential as just used (replay defense, spec §10). */
export function updateCredentialCounter(credentialId: string, counter: number): void {
  getDb()
    .prepare('UPDATE credentials SET counter = ?, last_used_at = ? WHERE credential_id = ?')
    .run(counter, nowSeconds(), credentialId);
}

/** Delete a credential owned by `userId`. Returns whether a row was removed. */
export function deleteCredential(userId: string, id: string): boolean {
  return (
    getDb().prepare('DELETE FROM credentials WHERE id = ? AND user_id = ?').run(id, userId)
      .changes > 0
  );
}
