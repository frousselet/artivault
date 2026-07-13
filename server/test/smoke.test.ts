import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

// Configure a minimal, in-memory environment BEFORE importing app modules, which
// validate config at import time. Dynamic imports below run after these are set.
process.env.NODE_ENV = 'test';
process.env.PUBLIC_BASE_URL = 'http://localhost:8787';
process.env.EXPECTED_ORIGIN = 'http://localhost:8787';
process.env.RP_ID = 'localhost';
process.env.DATABASE_FILE = ':memory:';
process.env.SESSION_SECRET = 'test-secret-session-0000000000000000';
process.env.CSRF_SECRET = 'test-secret-csrf-0000000000000000';
process.env.CAPABILITY_TOKEN_SECRET = 'test-secret-capability-0000000000';
process.env.OAUTH_TOKEN_SECRET = 'test-secret-oauth-00000000000000000';

// A deterministic built-SPA directory, so static serving and the SPA fallback are
// exercised regardless of whether `web/dist` was built in this checkout.
const webDist = mkdtempSync(join(tmpdir(), 'artivault-web-'));
writeFileSync(join(webDist, 'index.html'), '<!doctype html><body><div id="app"></div></body>');
process.env.WEB_DIST_DIR = webDist;

const { buildApp } = await import('../src/app.js');
const { getDb } = await import('../src/db/index.js');
const { runMigrations } = await import('../src/db/migrate.js');

runMigrations(getDb());
const app = buildApp();

test('healthz returns ok', async () => {
  const res = await app.request('/healthz');
  assert.equal(res.status, 200);
  const body = (await res.json()) as { status: string };
  assert.equal(body.status, 'ok');
});

test('readyz reports database connectivity', async () => {
  const res = await app.request('/readyz');
  assert.equal(res.status, 200);
  const body = (await res.json()) as { db: string };
  assert.equal(body.db, 'ok');
});

test('the render route applies the sandbox CSP even for an unknown slug', async () => {
  const res = await app.request('/artifact/does-not-exist');
  assert.equal(res.status, 404);
  const csp = res.headers.get('content-security-policy') ?? '';
  assert.match(csp, /sandbox/);
  assert.match(csp, /allow-scripts/);
  assert.doesNotMatch(csp, /allow-same-origin/);
});

test('oauth discovery advertises PKCE and the endpoints', async () => {
  const res = await app.request('/.well-known/oauth-authorization-server');
  assert.equal(res.status, 200);
  const meta = (await res.json()) as {
    issuer: string;
    code_challenge_methods_supported: string[];
  };
  assert.equal(meta.issuer, 'http://localhost:8787');
  assert.deepEqual(meta.code_challenge_methods_supported, ['S256']);
});

test('an unknown API route returns a JSON 404, never the SPA shell', async () => {
  const res = await app.request('/api/does-not-exist');
  assert.equal(res.status, 404);
  assert.match(res.headers.get('content-type') ?? '', /application\/json/);
  const body = (await res.json()) as { error: string };
  assert.equal(body.error, 'not_found');
});

test('the built SPA is served at the root and as a deep-link fallback', async () => {
  const root = await app.request('/');
  assert.equal(root.status, 200);
  assert.match(await root.text(), /id="app"/);

  // A client-side route (e.g. /invite/<token>) must return the shell, not a 404,
  // so the SPA can handle routing.
  const deep = await app.request('/invite/some-token');
  assert.equal(deep.status, 200);
  assert.match(deep.headers.get('content-type') ?? '', /text\/html/);
  assert.match(await deep.text(), /id="app"/);
});
