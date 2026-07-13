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
const { createUser, searchUsers } = await import('../src/services/users.js');
const { createArtifact } = await import('../src/services/artifacts.js');
const { setShare, removeShare, listSharesWithGrantee } = await import('../src/services/shares.js');
const { artifactAccess, canEdit } = await import('../src/services/authorization.js');

runMigrations(getDb());
const app = buildApp();

const owner = createUser({ email: 'owner@ex.com', displayName: 'Owner' });
const grantee = createUser({ email: 'grantee@ex.com', displayName: 'Grantee' });

const newArtifact = () =>
  createArtifact({
    ownerId: owner.id,
    name: 'Doc',
    kind: 'html',
    content: '<p>hi</p>',
    editorId: owner.id,
    editorKind: 'user',
  });

function authHeaders(userId: string, withCsrf = false): Record<string, string> {
  const cookies = [`av_session=${createSession(userId, 't')}`];
  const headers: Record<string, string> = {};
  if (withCsrf) {
    cookies.push('av_csrf=t');
    headers['x-csrf-token'] = 't';
    headers['content-type'] = 'application/json';
  }
  headers.cookie = cookies.join('; ');
  return headers;
}

test('setShare / list / remove and access resolution', () => {
  const a = newArtifact();
  assert.equal(artifactAccess(a, grantee.id), null);

  setShare('artifact', a.id, grantee.id, 'read', owner.id);
  assert.equal(artifactAccess(a, grantee.id), 'read');
  assert.equal(canEdit('read'), false);

  setShare('artifact', a.id, grantee.id, 'write', owner.id); // upsert
  assert.equal(artifactAccess(a, grantee.id), 'write');

  const shares = listSharesWithGrantee('artifact', a.id);
  assert.equal(shares.length, 1);
  assert.equal(shares[0]?.email, 'grantee@ex.com');

  assert.equal(removeShare('artifact', a.id, grantee.id), true);
  assert.equal(artifactAccess(a, grantee.id), null);
});

test('only the owner can manage shares over HTTP', async () => {
  const a = newArtifact();
  const ok = await app.request(`/api/artifacts/${a.id}/shares`, {
    method: 'POST',
    headers: authHeaders(owner.id, true),
    body: JSON.stringify({ email: 'grantee@ex.com', permission: 'write' }),
  });
  assert.equal(ok.status, 201);
  assert.equal(((await ok.json()) as { shares: unknown[] }).shares.length, 1);

  const denied = await app.request(`/api/artifacts/${a.id}/shares`, {
    method: 'POST',
    headers: authHeaders(grantee.id, true),
    body: JSON.stringify({ email: 'owner@ex.com', permission: 'read' }),
  });
  assert.equal(denied.status, 403);
});

test('a write share enables editing; a read share does not', async () => {
  const a = newArtifact();

  setShare('artifact', a.id, grantee.id, 'read', owner.id);
  const readRes = await app.request(`/api/artifacts/${a.id}`, {
    method: 'PATCH',
    headers: authHeaders(grantee.id, true),
    body: JSON.stringify({ baseVersion: 1, content: 'nope' }),
  });
  assert.equal(readRes.status, 403);

  setShare('artifact', a.id, grantee.id, 'write', owner.id);
  const writeRes = await app.request(`/api/artifacts/${a.id}`, {
    method: 'PATCH',
    headers: authHeaders(grantee.id, true),
    body: JSON.stringify({ baseVersion: 1, content: '<p>edited</p>' }),
  });
  assert.equal(writeRes.status, 200);
});

test('sharing with an unknown email is 404; with the owner is 400', async () => {
  const a = newArtifact();
  const unknown = await app.request(`/api/artifacts/${a.id}/shares`, {
    method: 'POST',
    headers: authHeaders(owner.id, true),
    body: JSON.stringify({ email: 'nobody@ex.com', permission: 'read' }),
  });
  assert.equal(unknown.status, 404);

  const self = await app.request(`/api/artifacts/${a.id}/shares`, {
    method: 'POST',
    headers: authHeaders(owner.id, true),
    body: JSON.stringify({ email: 'owner@ex.com', permission: 'read' }),
  });
  assert.equal(self.status, 400);
});

test('user search matches by name/email and excludes the caller', () => {
  assert.ok(searchUsers('grantee', owner.id).some((u) => u.email === 'grantee@ex.com'));
  assert.equal(
    searchUsers('owner', owner.id).some((u) => u.id === owner.id),
    false,
  );
});

test('the user-search endpoint requires a session', async () => {
  const anon = await app.request('/api/users/search?q=grantee');
  assert.equal(anon.status, 401);

  const ok = await app.request('/api/users/search?q=grantee', { headers: authHeaders(owner.id) });
  assert.equal(ok.status, 200);
  const body = (await ok.json()) as { users: { email: string }[] };
  assert.ok(body.users.some((u) => u.email === 'grantee@ex.com'));
});
