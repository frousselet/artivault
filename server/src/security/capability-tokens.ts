import { type JWTPayload, jwtVerify, SignJWT } from 'jose';
import { config } from '../config/env.js';

// Short-lived, signed tokens that let a sandboxed artifact read a specific
// linked dataset without a session cookie (spec §11). Read-only by construction.

const secret = new TextEncoder().encode(config.CAPABILITY_TOKEN_SECRET);
const ISSUER = 'artivault';
const AUDIENCE = 'render-data';

export interface CapabilityClaims {
  /** Artifact this render context belongs to. */
  artifactId: string;
  /** Dataset the token grants read access to. */
  datasetId: string;
  /** Binds the token to a single render of the artifact. */
  renderNonce: string;
}

export async function mintCapabilityToken(claims: CapabilityClaims): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${config.CAPABILITY_TOKEN_TTL_SECONDS}s`)
    .sign(secret);
}

export async function verifyCapabilityToken(token: string): Promise<CapabilityClaims & JWTPayload> {
  const { payload } = await jwtVerify(token, secret, { issuer: ISSUER, audience: AUDIENCE });
  if (typeof payload.artifactId !== 'string' || typeof payload.datasetId !== 'string') {
    throw new Error('malformed capability token');
  }
  return payload as CapabilityClaims & JWTPayload;
}
