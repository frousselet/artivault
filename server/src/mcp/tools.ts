// Catalogue of MCP tools (spec §14). Names are the contract exposed to agents;
// `write` marks tools that mutate state (and therefore acquire the lock, create a
// version, and write an audit entry with actor_kind = 'agent').

export type McpToolCategory = 'artifacts' | 'datasets' | 'links_sharing' | 'locks';

export interface McpToolDef {
  name: string;
  category: McpToolCategory;
  write: boolean;
  description: string;
}

export const MCP_TOOLS: McpToolDef[] = [
  // Artifacts
  {
    name: 'list_artifacts',
    category: 'artifacts',
    write: false,
    description: 'List artifacts owned by or shared with the user.',
  },
  {
    name: 'get_artifact',
    category: 'artifacts',
    write: false,
    description: 'Get an artifact: content, render URL, visibility, current version, lock state.',
  },
  {
    name: 'create_artifact',
    category: 'artifacts',
    write: true,
    description: 'Create an artifact; returns its absolute render URL.',
  },
  {
    name: 'update_artifact',
    category: 'artifacts',
    write: true,
    description: 'Update an artifact (auto lock, new version, optimistic base-version check).',
  },
  {
    name: 'set_artifact_visibility',
    category: 'artifacts',
    write: true,
    description: 'Make an artifact public or private.',
  },
  {
    name: 'delete_artifact',
    category: 'artifacts',
    write: true,
    description: 'Delete an artifact.',
  },
  {
    name: 'list_artifact_versions',
    category: 'artifacts',
    write: false,
    description: 'List an artifact’s version history.',
  },
  {
    name: 'restore_artifact_version',
    category: 'artifacts',
    write: true,
    description: 'Promote a past version to a new head.',
  },
  {
    name: 'delete_artifact_version',
    category: 'artifacts',
    write: true,
    description: 'Delete a single non-head version.',
  },
  // Datasets
  {
    name: 'list_datasets',
    category: 'datasets',
    write: false,
    description: 'List datasets owned by or shared with the user.',
  },
  {
    name: 'get_dataset',
    category: 'datasets',
    write: false,
    description: 'Get dataset metadata and (for inline) content.',
  },
  {
    name: 'create_dataset',
    category: 'datasets',
    write: true,
    description: 'Create an inline or SQLite-file dataset.',
  },
  {
    name: 'update_dataset',
    category: 'datasets',
    write: true,
    description: 'Update a dataset (new version).',
  },
  { name: 'delete_dataset', category: 'datasets', write: true, description: 'Delete a dataset.' },
  {
    name: 'query_dataset',
    category: 'datasets',
    write: false,
    description: 'Run a read-only SELECT against a SQLite-file dataset.',
  },
  {
    name: 'list_dataset_versions',
    category: 'datasets',
    write: false,
    description: 'List a dataset’s version history.',
  },
  {
    name: 'restore_dataset_version',
    category: 'datasets',
    write: true,
    description: 'Promote a past dataset version to a new head.',
  },
  {
    name: 'delete_dataset_version',
    category: 'datasets',
    write: true,
    description: 'Delete a single non-head dataset version.',
  },
  // Links & sharing
  {
    name: 'link_dataset',
    category: 'links_sharing',
    write: true,
    description: 'Link a dataset to an artifact.',
  },
  {
    name: 'unlink_dataset',
    category: 'links_sharing',
    write: true,
    description: 'Unlink a dataset from an artifact.',
  },
  {
    name: 'share_artifact',
    category: 'links_sharing',
    write: true,
    description: 'Grant read/write on an artifact to a user.',
  },
  {
    name: 'unshare_artifact',
    category: 'links_sharing',
    write: true,
    description: 'Revoke a user’s access to an artifact.',
  },
  {
    name: 'share_dataset',
    category: 'links_sharing',
    write: true,
    description: 'Grant read/write on a dataset to a user.',
  },
  {
    name: 'unshare_dataset',
    category: 'links_sharing',
    write: true,
    description: 'Revoke a user’s access to a dataset.',
  },
  // Locks
  {
    name: 'acquire_lock',
    category: 'locks',
    write: true,
    description: 'Acquire the resource lock for a longer editing session.',
  },
  {
    name: 'release_lock',
    category: 'locks',
    write: true,
    description: 'Release a held resource lock.',
  },
];

export const mcpToolNames = (): string[] => MCP_TOOLS.map((t) => t.name);
