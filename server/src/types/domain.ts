// TypeScript mirror of the SQLite schema (spec §6). Row shapes returned by
// better-sqlite3, using unix-seconds integers for timestamps.

export type Role = 'admin' | 'user';
export type ArtifactKind = 'html' | 'svg' | 'markdown';
export type Visibility = 'private' | 'public';
export type ResourceKind = 'artifact' | 'dataset';
export type Permission = 'read' | 'write';
export type EditorKind = 'user' | 'agent';
export type HolderKind = 'user' | 'agent';
export type ActorKind = 'user' | 'agent';
export type DatasetStorage = 'inline' | 'sqlite_file';
export type DatasetFormat = 'csv' | 'json' | 'sqlite';

export interface User {
  id: string;
  email: string;
  display_name: string;
  role: Role;
  disabled: 0 | 1;
  created_at: number;
}

export interface Credential {
  id: string;
  user_id: string;
  credential_id: string;
  public_key: Uint8Array;
  counter: number;
  transports: string | null;
  device_name: string | null;
  created_at: number;
  last_used_at: number | null;
}

export interface Artifact {
  id: string;
  owner_id: string;
  slug: string;
  name: string;
  kind: ArtifactKind;
  content: string;
  visibility: Visibility;
  published_at: number | null;
  published_by: string | null;
  current_version: number;
  created_at: number;
  updated_at: number;
}

export interface ArtifactVersion {
  id: string;
  artifact_id: string;
  version: number;
  content: string;
  editor_id: string | null;
  editor_kind: EditorKind;
  note: string | null;
  created_at: number;
}

export interface Dataset {
  id: string;
  owner_id: string;
  slug: string;
  name: string;
  storage: DatasetStorage;
  format: DatasetFormat;
  content: string | null;
  file_path: string | null;
  current_version: number;
  created_at: number;
  updated_at: number;
}

export interface DatasetVersion {
  id: string;
  dataset_id: string;
  version: number;
  content: string | null;
  file_path: string | null;
  editor_id: string | null;
  editor_kind: EditorKind;
  note: string | null;
  created_at: number;
}

export interface Share {
  id: string;
  resource_kind: ResourceKind;
  resource_id: string;
  grantee_id: string;
  permission: Permission;
  created_by: string | null;
  created_at: number;
}

export interface Lock {
  id: string;
  resource_kind: ResourceKind;
  resource_id: string;
  holder_id: string;
  holder_kind: HolderKind;
  acquired_at: number;
  expires_at: number;
}

export interface Session {
  id: string;
  user_id: string;
  user_agent: string | null;
  created_at: number;
  expires_at: number;
}

export interface OAuthClient {
  id: string;
  client_id: string;
  client_name: string | null;
  redirect_uris: string;
  created_at: number;
}

export interface OAuthToken {
  id: string;
  user_id: string;
  client_id: string;
  access_token_hash: string;
  refresh_token_hash: string | null;
  scopes: string | null;
  expires_at: number;
  created_at: number;
}

export interface AuditEntry {
  id: string;
  actor_id: string | null;
  actor_kind: ActorKind;
  action: string;
  resource_kind: ResourceKind | null;
  resource_id: string | null;
  ip: string | null;
  detail: string | null;
  at: number;
}
