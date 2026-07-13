import { apiDelete, apiGet } from './api.js';

export interface Passkey {
  id: string;
  deviceName: string | null;
  createdAt: number;
  lastUsedAt: number | null;
}

export const listPasskeys = (): Promise<Passkey[]> =>
  apiGet<{ passkeys: Passkey[] }>('/api/auth/passkeys').then((r) => r.passkeys);

export const deletePasskey = (id: string): Promise<{ ok: boolean }> =>
  apiDelete<{ ok: boolean }>(`/api/auth/passkeys/${id}`);

export interface OAuthClient {
  clientId: string;
  clientName: string | null;
  createdAt: number;
}

export const listOAuthClients = (): Promise<OAuthClient[]> =>
  apiGet<{ clients: OAuthClient[] }>('/api/auth/oauth-clients').then((r) => r.clients);

export const revokeOAuthClient = (clientId: string): Promise<{ ok: boolean }> =>
  apiDelete<{ ok: boolean }>(`/api/auth/oauth-clients/${clientId}`);
