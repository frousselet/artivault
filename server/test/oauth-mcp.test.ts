import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
const oauth = await import('../src/services/oauth.js');

runMigrations(getDb());
const app = buildApp();
const user = createUser({ email: 'agent@example.com', displayName: 'Agent User' });

const CB = 'http://localhost:9999/callback';
const form = (data: Record<string, string>) => ({
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(data).toString(),
});

test('PKCE S256 verification', () => {
  const verifier = 'a'.repeat(64);
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  assert.equal(oauth.verifyPkceS256(verifier, challenge), true);
  assert.equal(oauth.verifyPkceS256('wrong', challenge), false);
});

test('dynamic client registration over HTTP', async () => {
  const res = await app.request('/oauth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'Test MCP', redirect_uris: [CB] }),
  });
  assert.equal(res.status, 201);
  const body = (await res.json()) as { client_id: string };
  assert.ok(body.client_id);
  assert.ok(oauth.getClient(body.client_id));
});

test('authorization_code + PKCE token exchange, single-use', async () => {
  const client = oauth.registerClient({ clientName: 'C', redirectUris: [CB] });
  const verifier = 'v'.repeat(64);
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const code = oauth.createAuthCode({
    clientId: client.clientId,
    userId: user.id,
    redirectUri: CB,
    codeChallenge: challenge,
    scope: 'mcp',
  });
  const args = {
    grant_type: 'authorization_code',
    code,
    client_id: client.clientId,
    redirect_uri: CB,
    code_verifier: verifier,
  };

  const res = await app.request('/oauth/token', form(args));
  assert.equal(res.status, 200);
  const tok = (await res.json()) as { access_token: string; token_type: string };
  assert.equal(tok.token_type, 'Bearer');
  assert.ok(oauth.validateAccessToken(tok.access_token));

  // the code is single-use
  const again = await app.request('/oauth/token', form(args));
  assert.equal(again.status, 400);
});

test('token exchange rejects a wrong PKCE verifier', async () => {
  const client = oauth.registerClient({ clientName: 'C2', redirectUris: [CB] });
  const challenge = createHash('sha256').update('real-verifier').digest('base64url');
  const code = oauth.createAuthCode({
    clientId: client.clientId,
    userId: user.id,
    redirectUri: CB,
    codeChallenge: challenge,
    scope: 'mcp',
  });
  const res = await app.request(
    '/oauth/token',
    form({
      grant_type: 'authorization_code',
      code,
      client_id: client.clientId,
      redirect_uri: CB,
      code_verifier: 'not-the-verifier',
    }),
  );
  assert.equal(res.status, 400);
});

test('the MCP endpoint requires a bearer and completes the handshake', async () => {
  const rpc = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 't', version: '1' },
    },
  };
  const headers = (auth?: string) => ({
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    ...(auth ? { authorization: `Bearer ${auth}` } : {}),
  });

  const anon = await app.request('/mcp', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(rpc),
  });
  assert.equal(anon.status, 401);

  const { accessToken } = oauth.issueTokens(user.id, 'test-client', 'mcp');
  const res = await app.request('/mcp', {
    method: 'POST',
    headers: headers(accessToken),
    body: JSON.stringify(rpc),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { result?: { serverInfo?: { name?: string } } };
  assert.equal(body.result?.serverInfo?.name, 'artivault');
});
