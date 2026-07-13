import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { config } from '../config/env.js';
import { getDb } from '../db/index.js';
import type { OAuthClient, OAuthToken } from '../types/domain.js';
import { nowSeconds } from '../util/time.js';

// OAuth 2.1 authorization server for the MCP endpoint (spec §14). Tokens are
// opaque, stored hashed, and revocable. Authorization codes are single-use,
// short-lived, and PKCE-bound.

const sha256 = (v: string): string => createHash('sha256').update(v).digest('hex');

// --- Dynamic client registration (RFC 7591) ---

export interface RegisteredClient {
  clientId: string;
  clientName: string | null;
  redirectUris: string[];
}

export function registerClient(input: {
  clientName?: string | null;
  redirectUris: string[];
}): RegisteredClient {
  const clientId = randomUUID();
  getDb()
    .prepare('INSERT INTO oauth_clients (client_id, client_name, redirect_uris) VALUES (?, ?, ?)')
    .run(clientId, input.clientName ?? null, JSON.stringify(input.redirectUris));
  return { clientId, clientName: input.clientName ?? null, redirectUris: input.redirectUris };
}

export function getClient(clientId: string): RegisteredClient | null {
  const row = getDb().prepare('SELECT * FROM oauth_clients WHERE client_id = ?').get(clientId) as
    | OAuthClient
    | undefined;
  if (!row) return null;
  return {
    clientId: row.client_id,
    clientName: row.client_name,
    redirectUris: JSON.parse(row.redirect_uris) as string[],
  };
}

// --- Authorization codes (in-memory, single-use, short-lived) ---

interface AuthCodeRecord {
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  expiresAt: number;
}

const authCodes = new Map<string, AuthCodeRecord>();
const AUTH_CODE_TTL_SECONDS = 60;

export function createAuthCode(input: Omit<AuthCodeRecord, 'expiresAt'>): string {
  const code = randomBytes(32).toString('base64url');
  authCodes.set(code, { ...input, expiresAt: nowSeconds() + AUTH_CODE_TTL_SECONDS });
  return code;
}

export function consumeAuthCode(code: string): AuthCodeRecord | null {
  const rec = authCodes.get(code);
  if (!rec) return null;
  authCodes.delete(code); // single-use
  return rec.expiresAt > nowSeconds() ? rec : null;
}

/** Verify a PKCE `S256` challenge (the only method we accept, spec §14). */
export function verifyPkceS256(verifier: string, challenge: string): boolean {
  const computed = createHash('sha256').update(verifier).digest('base64url');
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

// --- Tokens ---

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string;
}

export function issueTokens(userId: string, clientId: string, scope: string): IssuedTokens {
  const accessToken = randomBytes(32).toString('base64url');
  const refreshToken = randomBytes(32).toString('base64url');
  getDb()
    .prepare(
      `INSERT INTO oauth_tokens
         (user_id, client_id, access_token_hash, refresh_token_hash, scopes, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      userId,
      clientId,
      sha256(accessToken),
      sha256(refreshToken),
      scope,
      nowSeconds() + config.OAUTH_ACCESS_TOKEN_TTL_SECONDS,
    );
  return { accessToken, refreshToken, expiresIn: config.OAUTH_ACCESS_TOKEN_TTL_SECONDS, scope };
}

export interface AccessContext {
  userId: string;
  clientId: string;
  scopes: string;
}

export function validateAccessToken(token: string): AccessContext | null {
  const row = getDb()
    .prepare('SELECT * FROM oauth_tokens WHERE access_token_hash = ?')
    .get(sha256(token)) as OAuthToken | undefined;
  if (!row || row.expires_at <= nowSeconds()) return null;
  return { userId: row.user_id, clientId: row.client_id, scopes: row.scopes ?? '' };
}

export function refreshAccessToken(refreshToken: string): IssuedTokens | null {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM oauth_tokens WHERE refresh_token_hash = ?')
    .get(sha256(refreshToken)) as OAuthToken | undefined;
  if (!row) return null;
  if (row.created_at + config.OAUTH_REFRESH_TOKEN_TTL_SECONDS <= nowSeconds()) {
    db.prepare('DELETE FROM oauth_tokens WHERE id = ?').run(row.id);
    return null;
  }
  const accessToken = randomBytes(32).toString('base64url');
  db.prepare('UPDATE oauth_tokens SET access_token_hash = ?, expires_at = ? WHERE id = ?').run(
    sha256(accessToken),
    nowSeconds() + config.OAUTH_ACCESS_TOKEN_TTL_SECONDS,
    row.id,
  );
  return {
    accessToken,
    refreshToken,
    expiresIn: config.OAUTH_ACCESS_TOKEN_TTL_SECONDS,
    scope: row.scopes ?? '',
  };
}

// --- Account management: authorized clients (spec §13) ---

export interface AuthorizedClient {
  clientId: string;
  clientName: string | null;
  createdAt: number;
}

export function listAuthorizedClients(userId: string): AuthorizedClient[] {
  return getDb()
    .prepare(
      `SELECT t.client_id AS clientId, c.client_name AS clientName, MIN(t.created_at) AS createdAt
       FROM oauth_tokens t
       LEFT JOIN oauth_clients c ON c.client_id = t.client_id
       WHERE t.user_id = ?
       GROUP BY t.client_id
       ORDER BY createdAt DESC`,
    )
    .all(userId) as AuthorizedClient[];
}

export function revokeClient(userId: string, clientId: string): boolean {
  return (
    getDb()
      .prepare('DELETE FROM oauth_tokens WHERE user_id = ? AND client_id = ?')
      .run(userId, clientId).changes > 0
  );
}
