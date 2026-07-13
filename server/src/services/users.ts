import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';
import type { Role, User } from '../types/domain.js';
import { recordAudit } from './audit.js';

export function countUsers(): number {
  return (getDb().prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
}

export function getUserByEmail(email: string): User | null {
  return (
    (getDb().prepare('SELECT * FROM users WHERE email = ?').get(email) as User | undefined) ?? null
  );
}

export function getUserById(id: string): User | null {
  return (getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined) ?? null;
}

export interface CreateUserInput {
  email: string;
  displayName: string;
  /** Omitted → 'admin' for the very first account (bootstrap, spec §10), else 'user'. */
  role?: Role;
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
    actorId: id,
    actorKind: 'user',
    action: 'user.create',
    resourceKind: null,
    resourceId: id,
    detail: { email: user.email, role: user.role },
  });
  return user;
}
