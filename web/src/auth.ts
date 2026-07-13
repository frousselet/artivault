import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { apiPost } from './api.js';

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  role: string;
}

interface AuthResult {
  ok: boolean;
  user: SessionUser;
}

// Derive the option JSON shapes from the browser SDK so no extra type imports are needed.
type RegistrationOptions = Parameters<typeof startRegistration>[0]['optionsJSON'];
type AuthenticationOptions = Parameters<typeof startAuthentication>[0]['optionsJSON'];

/** Register a passkey for `email` (creates/claims the account) and sign in. */
export async function registerPasskey(email: string): Promise<SessionUser> {
  const optionsJSON = await apiPost<RegistrationOptions>('/api/auth/register/options', { email });
  const response = await startRegistration({ optionsJSON });
  const result = await apiPost<AuthResult>('/api/auth/register/verify', { response });
  return result.user;
}

/** Authenticate with an existing passkey for `email`. */
export async function loginPasskey(email: string): Promise<SessionUser> {
  const optionsJSON = await apiPost<AuthenticationOptions>('/api/auth/login/options', { email });
  const response = await startAuthentication({ optionsJSON });
  const result = await apiPost<AuthResult>('/api/auth/login/verify', { response });
  return result.user;
}
