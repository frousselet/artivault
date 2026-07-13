import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { jwtVerify, SignJWT } from 'jose';
import { CSRF_COOKIE, issueCsrfToken } from '../auth/csrf.js';
import { getAuth } from '../auth/session.js';
import { config } from '../config/env.js';
import { recordAudit } from '../services/audit.js';
import {
  consumeAuthCode,
  createAuthCode,
  getClient,
  issueTokens,
  refreshAccessToken,
  registerClient,
  verifyPkceS256,
} from '../services/oauth.js';

export const oauthRoutes = new Hono();

const base = config.PUBLIC_BASE_URL.replace(/\/+$/, '');
const consentSecret = new TextEncoder().encode(config.OAUTH_TOKEN_SECRET);

// --- Discovery (RFC 8414 / RFC 9728, spec §14) ---

oauthRoutes.get('/.well-known/oauth-authorization-server', (c) =>
  c.json({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    scopes_supported: ['mcp'],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
  }),
);

oauthRoutes.get('/.well-known/oauth-protected-resource', (c) =>
  c.json({ resource: `${base}/mcp`, authorization_servers: [base] }),
);

// --- Dynamic client registration (RFC 7591) ---

oauthRoutes.post('/oauth/register', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const redirectUris = Array.isArray(body.redirect_uris)
    ? body.redirect_uris.filter((u): u is string => typeof u === 'string')
    : [];
  if (redirectUris.length === 0) {
    return c.json(
      { error: 'invalid_redirect_uri', error_description: 'redirect_uris required' },
      400,
    );
  }
  const clientName = typeof body.client_name === 'string' ? body.client_name : null;
  const client = registerClient({ clientName, redirectUris });
  return c.json(
    {
      client_id: client.clientId,
      client_name: client.clientName,
      redirect_uris: client.redirectUris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    },
    201,
  );
});

// --- Authorization endpoint (code flow + PKCE) ---

interface ConsentClaims {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  state: string;
}

const redirectWith = (uri: string, params: Record<string, string>): string => {
  const url = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
  return url.toString();
};

oauthRoutes.get('/oauth/authorize', async (c) => {
  const q = c.req.query();
  const client = q.client_id ? getClient(q.client_id) : null;
  // An invalid client or redirect_uri must NOT redirect (OAuth 2.1 §4.1.2.1).
  if (!client) return c.html(page('Authorization error', 'Unknown or unregistered client.'), 400);
  if (!q.redirect_uri || !client.redirectUris.includes(q.redirect_uri)) {
    return c.html(page('Authorization error', 'Invalid redirect_uri for this client.'), 400);
  }
  const redirectUri = q.redirect_uri;
  const state = q.state ?? '';
  if (q.response_type !== 'code') {
    return c.redirect(redirectWith(redirectUri, { error: 'unsupported_response_type', state }));
  }
  if (!q.code_challenge || q.code_challenge_method !== 'S256') {
    return c.redirect(
      redirectWith(redirectUri, {
        error: 'invalid_request',
        error_description: 'PKCE S256 required',
        state,
      }),
    );
  }

  const auth = getAuth(c);
  if (!auth) {
    return c.html(
      page(
        'Sign in required',
        `Sign in to Artivault first, then reopen this authorization link.
         <p style="margin-top:1rem"><a href="${escapeAttr(base)}/">Open Artivault</a></p>`,
      ),
      401,
    );
  }

  const request = await new SignJWT({
    clientId: client.clientId,
    redirectUri,
    codeChallenge: q.code_challenge,
    scope: q.scope ?? 'mcp',
    state,
  } satisfies ConsentClaims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(consentSecret);
  const csrf = issueCsrfToken(c);

  return c.html(consentPage(client.clientName ?? client.clientId, auth.user.email, request, csrf));
});

oauthRoutes.post('/oauth/authorize', async (c) => {
  const auth = getAuth(c);
  if (!auth)
    return c.html(page('Sign in required', 'Your session expired. Sign in and retry.'), 401);

  const form = await c.req.parseBody();
  const cookieCsrf = getCookie(c, CSRF_COOKIE);
  if (!form.csrf || typeof form.csrf !== 'string' || form.csrf !== cookieCsrf) {
    return c.html(page('Authorization error', 'CSRF check failed. Reload and retry.'), 403);
  }

  let claims: ConsentClaims;
  try {
    const { payload } = await jwtVerify(String(form.request), consentSecret);
    claims = payload as unknown as ConsentClaims;
  } catch {
    return c.html(page('Authorization error', 'This authorization request expired.'), 400);
  }

  if (form.decision !== 'approve') {
    return c.redirect(
      redirectWith(claims.redirectUri, { error: 'access_denied', state: claims.state }),
    );
  }

  const code = createAuthCode({
    clientId: claims.clientId,
    userId: auth.user.id,
    redirectUri: claims.redirectUri,
    codeChallenge: claims.codeChallenge,
    scope: claims.scope,
  });
  recordAudit({
    actorId: auth.user.id,
    actorKind: 'user',
    action: 'oauth.authorize',
    detail: { client: claims.clientId, scope: claims.scope },
  });
  return c.redirect(redirectWith(claims.redirectUri, { code, state: claims.state }));
});

// --- Token endpoint ---

oauthRoutes.post('/oauth/token', async (c) => {
  const form = await c.req.parseBody();
  const grantType = String(form.grant_type ?? '');
  c.header('Cache-Control', 'no-store');

  if (grantType === 'authorization_code') {
    const rec = consumeAuthCode(String(form.code ?? ''));
    if (
      !rec ||
      rec.clientId !== form.client_id ||
      rec.redirectUri !== form.redirect_uri ||
      typeof form.code_verifier !== 'string' ||
      !verifyPkceS256(form.code_verifier, rec.codeChallenge)
    ) {
      return c.json({ error: 'invalid_grant' }, 400);
    }
    return c.json(tokenResponse(issueTokens(rec.userId, rec.clientId, rec.scope)));
  }

  if (grantType === 'refresh_token') {
    const tokens = refreshAccessToken(String(form.refresh_token ?? ''));
    if (!tokens) return c.json({ error: 'invalid_grant' }, 400);
    return c.json(tokenResponse(tokens));
  }

  return c.json({ error: 'unsupported_grant_type' }, 400);
});

function tokenResponse(t: {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string;
}) {
  return {
    access_token: t.accessToken,
    token_type: 'Bearer',
    expires_in: t.expiresIn,
    refresh_token: t.refreshToken,
    scope: t.scope,
  };
}

// --- Server-rendered pages ---

function shell(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>
  body{font-family:system-ui,-apple-system,sans-serif;background:#f6f7f9;color:#191c22;margin:0;
       min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1.5rem}
  @media(prefers-color-scheme:dark){body{background:#0e1014;color:#e6e8ec}}
  .card{background:#fff;border:1px solid #e3e6eb;border-radius:16px;max-width:26rem;width:100%;padding:1.75rem;
        box-shadow:0 8px 28px rgba(16,24,40,.12)}
  @media(prefers-color-scheme:dark){.card{background:#161922;border-color:#2a303c}}
  h1{font-size:1.3rem;margin:0 0 .5rem} p{color:#6b7280;line-height:1.6}
  .row{display:flex;gap:.6rem;margin-top:1.25rem} a{color:#4f46e5}
  button{flex:1;padding:.65rem 1rem;font-size:.95rem;font-weight:600;border-radius:8px;cursor:pointer;border:1px solid transparent}
  .approve{background:#4f46e5;color:#fff} .deny{background:transparent;border-color:#e3e6eb;color:inherit}
  strong{color:inherit}
</style></head><body><div class="card">${body}</div></body></html>`;
}

const page = (title: string, message: string): string =>
  shell(title, `<h1>${escapeHtml(title)}</h1><p>${message}</p>`);

function consentPage(clientName: string, email: string, request: string, csrf: string): string {
  return shell(
    'Authorize',
    `<h1>Authorize access</h1>
     <p><strong>${escapeHtml(clientName)}</strong> is requesting access to your Artivault account
        (<strong>${escapeHtml(email)}</strong>) to read and write your artifacts and datasets on your behalf.</p>
     <form method="post" action="/oauth/authorize">
       <input type="hidden" name="request" value="${escapeAttr(request)}" />
       <input type="hidden" name="csrf" value="${escapeAttr(csrf)}" />
       <div class="row">
         <button class="deny" type="submit" name="decision" value="deny">Deny</button>
         <button class="approve" type="submit" name="decision" value="approve">Approve</button>
       </div>
     </form>`,
  );
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
const escapeAttr = (s: string): string => escapeHtml(s);
