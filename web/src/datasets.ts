import { apiDelete, apiGet, apiPatch, apiPost, apiUpload } from './api.js';

export type DatasetStorage = 'inline' | 'sqlite_file';
export type DatasetFormat = 'csv' | 'json' | 'sqlite';
export type Access = 'owner' | 'write' | 'read';

export interface DatasetSummary {
  id: string;
  slug: string;
  name: string;
  storage: DatasetStorage;
  format: DatasetFormat;
  currentVersion: number;
  ownerId: string;
  createdAt: number;
  updatedAt: number;
  url: string;
  access?: Access;
  shareCount?: number;
}

export interface Dataset extends DatasetSummary {
  content?: string;
}

export interface DatasetVersionInfo {
  version: number;
  editorKind: 'user' | 'agent';
  note: string | null;
  createdAt: number;
}

export interface QueryResult {
  columns: string[];
  rows: unknown[];
  truncated: boolean;
}

export const listDatasets = (): Promise<DatasetSummary[]> =>
  apiGet<{ datasets: DatasetSummary[] }>('/api/datasets').then((r) => r.datasets);

export const getDataset = (id: string): Promise<Dataset> =>
  apiGet<{ dataset: Dataset }>(`/api/datasets/${id}`).then((r) => r.dataset);

export const createInlineDataset = (input: {
  name: string;
  format: 'csv' | 'json';
  content: string;
}): Promise<Dataset> =>
  apiPost<{ dataset: Dataset }>('/api/datasets', input).then((r) => r.dataset);

export const updateDataset = (
  id: string,
  input: { baseVersion: number; content: string; name?: string },
): Promise<Dataset> =>
  apiPatch<{ dataset: Dataset }>(`/api/datasets/${id}`, input).then((r) => r.dataset);

export const deleteDataset = (id: string): Promise<{ ok: boolean }> =>
  apiDelete<{ ok: boolean }>(`/api/datasets/${id}`);

export const queryDataset = (id: string, sql: string): Promise<QueryResult> =>
  apiPost<QueryResult>(`/api/datasets/${id}/query`, { sql });

export const listDatasetVersions = (id: string): Promise<DatasetVersionInfo[]> =>
  apiGet<{ versions: DatasetVersionInfo[] }>(`/api/datasets/${id}/versions`).then(
    (r) => r.versions,
  );

export function createSqliteDataset(name: string, file: File): Promise<Dataset> {
  const fd = new FormData();
  fd.append('name', name);
  fd.append('file', file);
  return apiUpload<{ dataset: Dataset }>('/api/datasets', fd).then((r) => r.dataset);
}

export function replaceSqliteFile(id: string, file: File, baseVersion: number): Promise<Dataset> {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('baseVersion', String(baseVersion));
  return apiUpload<{ dataset: Dataset }>(`/api/datasets/${id}/content`, fd).then((r) => r.dataset);
}

// --- Linked datasets on an artifact ---

export interface LinkedDataset {
  id: string;
  name: string;
  storage: DatasetStorage;
  format: DatasetFormat;
  currentVersion: number;
  access: Access;
}

export const listArtifactDatasets = (artifactId: string): Promise<LinkedDataset[]> =>
  apiGet<{ datasets: LinkedDataset[] }>(`/api/artifacts/${artifactId}/datasets`).then(
    (r) => r.datasets,
  );

export const linkDataset = (artifactId: string, datasetId: string): Promise<{ ok: boolean }> =>
  apiPost<{ ok: boolean }>(`/api/artifacts/${artifactId}/datasets`, { datasetId });

export const unlinkDataset = (artifactId: string, datasetId: string): Promise<{ ok: boolean }> =>
  apiDelete<{ ok: boolean }>(`/api/artifacts/${artifactId}/datasets/${datasetId}`);
