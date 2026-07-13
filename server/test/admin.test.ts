import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.PUBLIC_BASE_URL = 'http://localhost:8787';
process.env.EXPECTED_ORIGIN = 'http://localhost:8787';
process.env.RP_ID = 'localhost';
process.env.DATABASE_FILE = ':memory:';
process.env.SESSION_SECRET = 'test-secret-session-0000000000000000';
process.env.CSRF_SECRET = 'test-secret-csrf-0000000000000000';
process.env.CAPABILITY_TOKEN_SECRET = 'test-secret-capability-0000000000';
process.env.OAUTH_TOKEN_SECRET = 'test-secret-oauth-00000000000000000';

const { buildApp } = await import('../src/app.js');
const { getDb } = await import('../src/db/index.js');
const { runMigrations } = await import('../src/db/migrate.js');
const { createSession } = await import('../src/auth/session.js');
const { createUser, updateUser, listUsersWithCounts, countActiveAdmins } = await import(
  '../src/services/users.js'
);

runMigrations(getDb());
const app = buildApp();
const cookie = (token: string) => ({ headers: { cookie: `av_session=${token}` } });

test('the admin API rejects anonymous requests', async () => {
  const res = await app.request('/api/admin/users');
  assert.equal(res.status, 401);
});

test('the first account is admin, later ones are plain users', () => {
  const admin = createUser({ email: 'admin@example.com', displayName: 'Admin' });
  assert.equal(admin.role, 'admin');
  assert.equal(createUser({ email: 'bob@example.com', displayName: 'Bob' }).role, 'user');
  assert.equal(countActiveAdmins(), 1);
});

test('updateUser promotes, disables, and reports counts', () => {
  const carol = createUser({ email: 'carol@example.com', displayName: 'Carol' });
  assert.equal(updateUser(carol.id, { role: 'admin' }).role, 'admin');
  assert.equal(updateUser(carol.id, { disabled: true }).disabled, 1);
  const rows = listUsersWithCounts();
  assert.ok(rows.length >= 3);
  assert.ok('credential_count' in rows[0]);
});

test('an admin session can list users; a plain user is forbidden', async () => {
  const admin = createUser({ email: 'root@example.com', displayName: 'Root', role: 'admin' });
  const plain = createUser({ email: 'plain@example.com', displayName: 'Plain', role: 'user' });

  const ok = await app.request('/api/admin/users', cookie(createSession(admin.id, 't')));
  assert.equal(ok.status, 200);
  const body = (await ok.json()) as { users: unknown[] };
  assert.ok(Array.isArray(body.users));

  const denied = await app.request('/api/admin/users', cookie(createSession(plain.id, 't')));
  assert.equal(denied.status, 403);
});
