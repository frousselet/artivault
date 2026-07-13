import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';
import type { Role, User } from '../types/domain.js';
import { recordAudit } from './audit.js';

export function countUsers(): number {
  return (getDb().prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
}

/** Enabled accounts with the admin role (used to prevent locking out all admins). */
export function countActiveAdmins(): number {
  return (
    getDb()
      .prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0")
      .get() as { n: number }
  ).n;
}

export function getUserByEmail(email: string): User | null {
  return (
    (getDb().prepare('SELECT * FROM users WHERE email = ?').get(email) as User | undefined) ?? null
  );
}

export function getUserById(id: string): User | null {
  return (getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined) ?? null;
}

export interface UserWithCounts extends User {
  credential_count: number;
  artifact_count: number;
}

/** All users with their passkey and artifact counts, for the admin listing (spec §13). */
export function listUsersWithCounts(): UserWithCounts[] {
  return getDb()
    .prepare(
      `SELECT u.*,
         (SELECT COUNT(*) FROM credentials c WHERE c.user_id = u.id) AS credential_count,
         (SELECT COUNT(*) FROM artifacts a WHERE a.owner_id = u.id) AS artifact_count
       FROM users u
       ORDER BY u.created_at`,
    )
    .all() as UserWithCounts[];
}

/** Enabled users matching a query on email or display name — for the share picker (spec §8). */
export function searchUsers(query: string, excludeId: string, limit = 8): User[] {
  const like = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
  return getDb()
    .prepare(
      `SELECT * FROM users
       WHERE disabled = 0 AND id != ?
         AND (email LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\')
       ORDER BY email
       LIMIT ?`,
    )
    .all(excludeId, like, like, limit) as User[];
}

export interface CreateUserInput {
  email: string;
  displayName: string;
  /** Omitted → 'admin' for the very first account (bootstrap, spec §10), else 'user'. */
  role?: Role;
  /** Audit actor; defaults to the new user (bootstrap/self-registration). */
  actorId?: string;
}

export function createUser(input: CreateUserInput): User {
  const db = getDb();
  const role: Role = input.role ?? (countUsers() === 0 ? 'admin' : 'user');
  const id = randomUUID();
  db.prepare('INSERT INTO users (id, email, display_name, role) VALUES (?, ?, ?, ?)').run(
    id,
    input.email,
    input.displayName,
    role,
  );
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User;
  recordAudit({
    actorId: input.actorId ?? id,
    actorKind: 'user',
    action: 'user.create',
    resourceKind: null,
    resourceId: id,
    detail: { email: user.email, role: user.role },
  });
  return user;
}

/** Update a user's role and/or enabled state. Disabling also revokes sessions. */
export function updateUser(id: string, changes: { role?: Role; disabled?: boolean }): User {
  const db = getDb();
  const sets: string[] = [];
  const values: (string | number)[] = [];
  if (changes.role !== undefined) {
    sets.push('role = ?');
    values.push(changes.role);
  }
  if (changes.disabled !== undefined) {
    sets.push('disabled = ?');
    values.push(changes.disabled ? 1 : 0);
  }
  if (sets.length > 0) {
    values.push(id);
    db.transaction(() => {
      db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...values);
      if (changes.disabled === true) {
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
      }
    })();
  }
  return getUserById(id) as User;
}
