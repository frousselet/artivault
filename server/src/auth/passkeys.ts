import {
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { jwtVerify, SignJWT } from 'jose';
import { config } from '../config/env.js';
import {
  addCredential,
  getCredentialByCredentialId,
  listCredentialsByUser,
  updateCredentialCounter,
} from '../services/credentials.js';
import {
  getInvitationById,
  isInvitationUsable,
  markInvitationUsed,
} from '../services/invitations.js';
import { getUserById } from '../services/users.js';
import type { User } from '../types/domain.js';
import { AppError, unauthorized } from '../util/http.js';

// WebAuthn passkey ceremonies (spec §10). The RP is pinned to the deployment
// domain via config.RP_ID / config.expectedOrigins.

const CEREMONY_COOKIE = 'av_webauthn';
const CEREMONY_TTL_SECONDS = 300;
const ceremonySecret = new TextEncoder().encode(config.SESSION_SECRET);

type CeremonyType = 'registration' | 'authentication';

interface CeremonyClaims {
  challenge: string;
  type: CeremonyType;
  userId?: string;
  invitationId?: string;
}

// The challenge is kept in a short-lived, signed, HttpOnly cookie so no server
// state is needed between the "options" and "verify" steps.
async function setCeremonyCookie(c: Context, claims: CeremonyClaims): Promise<void> {
  const token = await new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${CEREMONY_TTL_SECONDS}s`)
    .sign(ceremonySecret);
  setCookie(c, CEREMONY_COOKIE, token, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'Lax',
    path: '/',
    maxAge: CEREMONY_TTL_SECONDS,
  });
}

async function readCeremonyCookie(c: Context, expected: CeremonyType): Promise<CeremonyClaims> {
  const token = getCookie(c, CEREMONY_COOKIE);
  if (!token) throw new AppError(400, 'no_ceremony', 'no active WebAuthn ceremony');
  let claims: CeremonyClaims;
  try {
    const { payload } = await jwtVerify(token, ceremonySecret);
    claims = payload as unknown as CeremonyClaims;
  } catch {
    throw new AppError(400, 'bad_ceremony', 'invalid WebAuthn ceremony');
  }
  if (claims.type !== expected) throw new AppError(400, 'bad_ceremony', 'unexpected ceremony type');
  return claims;
}

function clearCeremonyCookie(c: Context): void {
  deleteCookie(c, CEREMONY_COOKIE, { path: '/' });
}

function parseTransports(json: string | null): AuthenticatorTransportFuture[] | undefined {
  if (!json) return undefined;
  try {
    const arr = JSON.parse(json) as AuthenticatorTransportFuture[];
    return Array.isArray(arr) && arr.length > 0 ? arr : undefined;
  } catch {
    return undefined;
  }
}

// --- Registration ---

export async function startPasskeyRegistration(
  c: Context,
  user: User,
  opts: { invitationId?: string } = {},
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const existing = listCredentialsByUser(user.id);
  const options = await generateRegistrationOptions({
    rpName: config.RP_NAME,
    rpID: config.RP_ID,
    userName: user.email,
    userDisplayName: user.display_name,
    userID: new TextEncoder().encode(user.id),
    attestationType: 'none',
    excludeCredentials: existing.map((cred) => ({
      id: cred.credential_id,
      transports: parseTransports(cred.transports),
    })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
  });
  await setCeremonyCookie(c, {
    challenge: options.challenge,
    type: 'registration',
    userId: user.id,
    invitationId: opts.invitationId,
  });
  return options;
}

export async function finishPasskeyRegistration(
  c: Context,
  response: RegistrationResponseJSON,
  deviceName: string | null,
): Promise<User> {
  const ceremony = await readCeremonyCookie(c, 'registration');
  if (!ceremony.userId) throw new AppError(400, 'bad_ceremony', 'ceremony missing user');

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: ceremony.challenge,
    expectedOrigin: config.expectedOrigins,
    expectedRPID: config.RP_ID,
    // Platform authenticators verify the user anyway; kept lenient so security
    // keys without a PIN can still register. TODO(spec §10): consider requiring UV.
    requireUserVerification: false,
  });
  if (!verification.verified || !verification.registrationInfo) {
    throw new AppError(400, 'registration_failed', 'passkey registration could not be verified');
  }

  const { credential } = verification.registrationInfo;

  // If this came from an invitation, re-check it is still usable and consume it
  // together with adding the credential (single-use invite).
  if (ceremony.invitationId) {
    const inv = getInvitationById(ceremony.invitationId);
    if (!inv || !isInvitationUsable(inv) || inv.user_id !== ceremony.userId) {
      throw new AppError(400, 'invalid_invitation', 'this invitation is no longer valid');
    }
  }
  addCredential({
    userId: ceremony.userId,
    credentialId: credential.id,
    publicKey: credential.publicKey,
    counter: credential.counter,
    transports: credential.transports,
    deviceName,
  });
  if (ceremony.invitationId) markInvitationUsed(ceremony.invitationId);
  clearCeremonyCookie(c);

  const user = getUserById(ceremony.userId);
  if (!user) throw new AppError(400, 'registration_failed', 'user not found');
  return user;
}

// --- Authentication ---

export async function startPasskeyAuthentication(
  c: Context,
  user: User | null,
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const allowCredentials = user
    ? listCredentialsByUser(user.id).map((cred) => ({
        id: cred.credential_id,
        transports: parseTransports(cred.transports),
      }))
    : undefined;
  const options = await generateAuthenticationOptions({
    rpID: config.RP_ID,
    userVerification: 'preferred',
    allowCredentials,
  });
  await setCeremonyCookie(c, { challenge: options.challenge, type: 'authentication' });
  return options;
}

export async function finishPasskeyAuthentication(
  c: Context,
  response: AuthenticationResponseJSON,
): Promise<User> {
  const ceremony = await readCeremonyCookie(c, 'authentication');
  const cred = getCredentialByCredentialId(response.id);
  if (!cred) throw unauthorized('unknown passkey');

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: ceremony.challenge,
    expectedOrigin: config.expectedOrigins,
    expectedRPID: config.RP_ID,
    requireUserVerification: false,
    credential: {
      id: cred.credential_id,
      publicKey: new Uint8Array(cred.public_key),
      counter: cred.counter,
      transports: parseTransports(cred.transports),
    },
  });
  if (!verification.verified) throw unauthorized('passkey verification failed');

  updateCredentialCounter(cred.credential_id, verification.authenticationInfo.newCounter);
  clearCeremonyCookie(c);

  const user = getUserById(cred.user_id);
  if (!user) throw unauthorized('account not found');
  return user;
}
