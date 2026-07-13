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
