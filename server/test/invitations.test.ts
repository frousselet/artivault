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
const { createUser } = await import('../src/services/users.js');
const { createInvitation, findUsableInvitation, markInvitationUsed } = await import(
  '../src/services/invitations.js'
);

runMigrations(getDb());
const app = buildApp();
// Ensure the deployment is past bootstrap for every test in this file.
createUser({ email: 'seed@example.com', displayName: 'Seed' });

// Double-submit CSRF pair for POSTs (no session needed).
const csrf = { cookie: 'av_csrf=t', 'x-csrf-token': 't', 'content-type': 'application/json' };

test('invitations are single-use and expiring', () => {
  const admin = createUser({ email: 'a1@example.com', displayName: 'A1' });
  const invitee = createUser({ email: 'i1@example.com', displayName: 'I1' });

  const { token, invitation } = createInvitation(invitee.id, admin.id, 3600);
  assert.equal(findUsableInvitation(token)?.user_id, invitee.id);

  markInvitationUsed(invitation.id);
  assert.equal(findUsableInvitation(token), null);

  const { token: expired } = createInvitation(invitee.id, admin.id, -1);
  assert.equal(findUsableInvitation(expired), null);
});

test('registration without an invitation is refused after bootstrap', async () => {
  const res = await app.request('/api/auth/register/options', {
    method: 'POST',
    headers: csrf,
    body: JSON.stringify({ email: 'stranger@example.com' }),
  });
  assert.equal(res.status, 403);
});

test('a valid invitation yields registration options', async () => {
  const admin = createUser({ email: 'a2@example.com', displayName: 'A2' });
  const invitee = createUser({ email: 'i2@example.com', displayName: 'I2' });
  const { token } = createInvitation(invitee.id, admin.id, 3600);

  const res = await app.request('/api/auth/register/options', {
    method: 'POST',
    headers: csrf,
    body: JSON.stringify({ invite: token }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { challenge?: string; user?: { name?: string } };
  assert.ok(body.challenge, 'options include a challenge');
});

test('the invite lookup reveals the email and 410s on a bad token', async () => {
  const admin = createUser({ email: 'a3@example.com', displayName: 'A3' });
  const invitee = createUser({ email: 'i3@example.com', displayName: 'I3' });
  const { token } = createInvitation(invitee.id, admin.id, 3600);

  const ok = await app.request(`/api/auth/invite/${token}`);
  assert.equal(ok.status, 200);
  assert.equal(((await ok.json()) as { email: string }).email, 'i3@example.com');

  const bad = await app.request('/api/auth/invite/does-not-exist');
  assert.equal(bad.status, 410);
});
