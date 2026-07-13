import assert from 'node:assert/strict';
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

test('artifact render carries the sandbox CSP without allow-same-origin', async () => {
  const res = await app.request('/artifact/example');
  assert.equal(res.status, 200);
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

test('unknown routes return a JSON 404', async () => {
  const res = await app.request('/nope');
  assert.equal(res.status, 404);
});
