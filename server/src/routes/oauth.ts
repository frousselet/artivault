import { Hono } from 'hono';
import { config } from '../config/env.js';
import { notImplemented } from '../util/http.js';

export const oauthRoutes = new Hono();

const base = config.PUBLIC_BASE_URL.replace(/\/+$/, '');

// --- Discovery (spec §14) — static metadata derived from the public base URL. ---

oauthRoutes.get('/.well-known/oauth-authorization-server', (c) =>
  c.json({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
  }),
);

oauthRoutes.get('/.well-known/oauth-protected-resource', (c) =>
  c.json({
    resource: `${base}/mcp`,
    authorization_servers: [base],
  }),
);

// --- Authorization server endpoints (spec §14) ---
// TODO(spec §14): authorization-code flow with PKCE.
//   /oauth/authorize → passkey login + client consent screen
//   /oauth/token     → exchange code, issue a bearer bound to the user's account
//   /oauth/register  → dynamic client registration (persists to oauth_clients)
oauthRoutes.get('/oauth/authorize', (c) => notImplemented(c, 'oauth_authorize'));
oauthRoutes.post('/oauth/token', (c) => notImplemented(c, 'oauth_token'));
oauthRoutes.post('/oauth/register', (c) => notImplemented(c, 'oauth_register'));
