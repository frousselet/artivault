import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from './api.js';

export type ArtifactKind = 'html' | 'svg' | 'markdown';
export type Visibility = 'private' | 'public';
export type Access = 'owner' | 'write' | 'read';
export type Permission = 'read' | 'write';

export interface Share {
  granteeId: string;
  email: string;
  displayName: string;
  permission: Permission;
  createdAt: number;
}

export interface ArtifactSummary {
  id: string;
  slug: string;
  name: string;
  kind: ArtifactKind;
  visibility: Visibility;
  currentVersion: number;
  ownerId: string;
  createdAt: number;
  updatedAt: number;
  url: string;
  access?: Access;
  shareCount?: number;
}

export interface Artifact extends ArtifactSummary {
  content: string;
}

export const listArtifacts = (): Promise<ArtifactSummary[]> =>
  apiGet<{ artifacts: ArtifactSummary[] }>('/api/artifacts').then((r) => r.artifacts);

export const getArtifact = (id: string): Promise<Artifact> =>
  apiGet<{ artifact: Artifact }>(`/api/artifacts/${id}`).then((r) => r.artifact);

export const createArtifact = (input: {
  name: string;
  kind: ArtifactKind;
  content: string;
}): Promise<Artifact> =>
  apiPost<{ artifact: Artifact }>('/api/artifacts', input).then((r) => r.artifact);

export const updateArtifact = (
  id: string,
  input: { baseVersion: number; content?: string; name?: string; kind?: ArtifactKind },
): Promise<Artifact> =>
  apiPatch<{ artifact: Artifact }>(`/api/artifacts/${id}`, input).then((r) => r.artifact);

export const setVisibility = (id: string, visibility: Visibility): Promise<Artifact> =>
  apiPut<{ artifact: Artifact }>(`/api/artifacts/${id}/visibility`, { visibility }).then(
    (r) => r.artifact,
  );

export const deleteArtifact = (id: string): Promise<{ ok: boolean }> =>
  apiDelete<{ ok: boolean }>(`/api/artifacts/${id}`);

export const previewArtifact = (kind: ArtifactKind, content: string): Promise<string> =>
  apiPost<{ html: string }>('/api/artifacts/preview', { kind, content }).then((r) => r.html);

export const listShares = (id: string): Promise<Share[]> =>
  apiGet<{ shares: Share[] }>(`/api/artifacts/${id}/shares`).then((r) => r.shares);

export const shareArtifact = (
  id: string,
  email: string,
  permission: Permission,
): Promise<Share[]> =>
  apiPost<{ shares: Share[] }>(`/api/artifacts/${id}/shares`, { email, permission }).then(
    (r) => r.shares,
  );

export const unshareArtifact = (id: string, granteeId: string): Promise<Share[]> =>
  apiDelete<{ shares: Share[] }>(`/api/artifacts/${id}/shares/${granteeId}`).then((r) => r.shares);
