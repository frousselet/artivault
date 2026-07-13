import { Hono } from 'hono';
import { notImplemented } from '../../util/http.js';

// Management API for datasets (spec §15). Handlers are stubs pending the
// services/datasets write paths.
export const datasetApiRoutes = new Hono();

datasetApiRoutes.get('/', (c) => notImplemented(c, 'list_datasets'));
datasetApiRoutes.post('/', (c) => notImplemented(c, 'create_dataset'));
datasetApiRoutes.get('/:id', (c) => notImplemented(c, 'get_dataset'));
datasetApiRoutes.patch('/:id', (c) => notImplemented(c, 'update_dataset'));
datasetApiRoutes.delete('/:id', (c) => notImplemented(c, 'delete_dataset'));

// Upload/replace the SQLite file for a sqlite_file dataset (spec §12, §15).
datasetApiRoutes.post('/:id/content', (c) => notImplemented(c, 'upload_dataset_file'));

// Read-only SQL query for sqlite_file datasets (spec §12).
datasetApiRoutes.post('/:id/query', (c) => notImplemented(c, 'query_dataset'));

// Versioning (spec §9).
datasetApiRoutes.get('/:id/versions', (c) => notImplemented(c, 'list_dataset_versions'));
datasetApiRoutes.post('/:id/versions/:v/restore', (c) =>
  notImplemented(c, 'restore_dataset_version'),
);
datasetApiRoutes.delete('/:id/versions/:v', (c) => notImplemented(c, 'delete_dataset_version'));

// Sharing (spec §8).
datasetApiRoutes.post('/:id/shares', (c) => notImplemented(c, 'share_dataset'));
datasetApiRoutes.delete('/:id/shares/:granteeId', (c) => notImplemented(c, 'unshare_dataset'));
