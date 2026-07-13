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
const { createArtifact, setArtifactVisibility, updateArtifact } = await import(
  '../src/services/artifacts.js'
);

runMigrations(getDb());
const app = buildApp();
const user = createUser({ email: 'owner@example.com', displayName: 'Owner' });

test('a markdown artifact renders to HTML through the sandbox', async () => {
  const art = createArtifact({
    ownerId: user.id,
    name: 'MD',
    kind: 'markdown',
    content: '# Hello',
    editorId: user.id,
    editorKind: 'user',
  });
  const pub = setArtifactVisibility(art.id, 'public', user.id);
  const res = await app.request(`/artifact/${pub.slug}`);
  assert.equal(res.status, 200);
  const csp = res.headers.get('content-security-policy') ?? '';
  assert.match(csp, /sandbox/);
  assert.doesNotMatch(csp, /allow-same-origin/);
  assert.match(await res.text(), /<h1>Hello<\/h1>/);
});

test('an html artifact is served as authored', async () => {
  const art = createArtifact({
    ownerId: user.id,
    name: 'H',
    kind: 'html',
    content: '<h2 id="x">Hi</h2>',
    editorId: user.id,
    editorKind: 'user',
  });
  const pub = setArtifactVisibility(art.id, 'public', user.id);
  const res = await app.request(`/artifact/${pub.slug}`);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '<h2 id="x">Hi</h2>');
});

test('a private artifact render is refused without a session', async () => {
  const art = createArtifact({
    ownerId: user.id,
    name: 'Secret',
    kind: 'html',
    content: '<p>secret</p>',
    editorId: user.id,
    editorKind: 'user',
  });
  const res = await app.request(`/artifact/${art.slug}`);
  assert.equal(res.status, 401);
});

test('the optimistic version check rejects a stale write', async () => {
  const art = createArtifact({
    ownerId: user.id,
    name: 'V',
    kind: 'html',
    content: 'v1',
    editorId: user.id,
    editorKind: 'user',
  });
  updateArtifact({
    artifactId: art.id,
    baseVersion: 1,
    content: 'v2',
    editorId: user.id,
    editorKind: 'user',
  });
  assert.throws(
    () =>
      updateArtifact({
        artifactId: art.id,
        baseVersion: 1, // stale
        content: 'v2-again',
        editorId: user.id,
        editorKind: 'user',
      }),
    /stale write/,
  );
});

test('the management API requires authentication', async () => {
  const res = await app.request('/api/artifacts');
  assert.equal(res.status, 401);
});
