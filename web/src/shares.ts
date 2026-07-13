import { apiDelete, apiGet, apiPost } from './api.js';

export type ResourceKind = 'artifact' | 'dataset';
export type Permission = 'read' | 'write';

export interface Share {
  granteeId: string;
  email: string;
  displayName: string;
  permission: Permission;
  createdAt: number;
}

const path = (kind: ResourceKind, id: string) => `/api/${kind}s/${id}/shares`;

export const listShares = (kind: ResourceKind, id: string): Promise<Share[]> =>
  apiGet<{ shares: Share[] }>(path(kind, id)).then((r) => r.shares);

export const shareResource = (
  kind: ResourceKind,
  id: string,
  email: string,
  permission: Permission,
): Promise<Share[]> =>
  apiPost<{ shares: Share[] }>(path(kind, id), { email, permission }).then((r) => r.shares);

export const unshareResource = (
  kind: ResourceKind,
  id: string,
  granteeId: string,
): Promise<Share[]> =>
  apiDelete<{ shares: Share[] }>(`${path(kind, id)}/${granteeId}`).then((r) => r.shares);
