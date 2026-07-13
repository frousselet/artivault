import { apiGet, apiPatch, apiPost } from './api.js';

export interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  role: 'admin' | 'user';
  disabled: boolean;
  createdAt: number;
  credentialCount: number;
  artifactCount: number;
}

export interface Invite {
  url: string;
  expiresAt: number;
}

export const listUsers = (): Promise<AdminUser[]> =>
  apiGet<{ users: AdminUser[] }>('/api/admin/users').then((r) => r.users);

export const createUser = (input: {
  email: string;
  displayName: string;
  role: 'admin' | 'user';
}): Promise<{ user: AdminUser; invite: Invite }> =>
  apiPost<{ user: AdminUser; invite: Invite }>('/api/admin/users', input);

export const generateInvite = (id: string): Promise<Invite> =>
  apiPost<{ invite: Invite }>(`/api/admin/users/${id}/invite`, {}).then((r) => r.invite);

export const updateUser = (
  id: string,
  changes: { role?: 'admin' | 'user'; disabled?: boolean },
): Promise<AdminUser> =>
  apiPatch<{ user: AdminUser }>(`/api/admin/users/${id}`, changes).then((r) => r.user);
