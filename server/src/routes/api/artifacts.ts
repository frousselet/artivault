import { Hono } from 'hono';
import { notImplemented } from '../../util/http.js';

// Management API for artifacts (spec §15). Handlers are stubs pending the
// services/artifacts write paths; the route surface mirrors the spec.
export const artifactApiRoutes = new Hono();

artifactApiRoutes.get('/', (c) => notImplemented(c, 'list_artifacts'));
artifactApiRoutes.post('/', (c) => notImplemented(c, 'create_artifact'));
artifactApiRoutes.get('/:id', (c) => notImplemented(c, 'get_artifact'));
artifactApiRoutes.patch('/:id', (c) => notImplemented(c, 'update_artifact'));
artifactApiRoutes.delete('/:id', (c) => notImplemented(c, 'delete_artifact'));

// Versioning (spec §9).
artifactApiRoutes.get('/:id/versions', (c) => notImplemented(c, 'list_artifact_versions'));
artifactApiRoutes.post('/:id/versions/:v/restore', (c) =>
  notImplemented(c, 'restore_artifact_version'),
);
artifactApiRoutes.delete('/:id/versions/:v', (c) => notImplemented(c, 'delete_artifact_version'));

// Locking (spec §8): acquire/refresh via POST, release via DELETE.
artifactApiRoutes.post('/:id/lock', (c) => notImplemented(c, 'acquire_or_refresh_lock'));
artifactApiRoutes.delete('/:id/lock', (c) => notImplemented(c, 'release_lock'));

// Sharing (spec §8).
artifactApiRoutes.get('/:id/shares', (c) => notImplemented(c, 'list_shares'));
artifactApiRoutes.post('/:id/shares', (c) => notImplemented(c, 'share_artifact'));
artifactApiRoutes.delete('/:id/shares/:granteeId', (c) => notImplemented(c, 'unshare_artifact'));

// Visibility (spec §11): publish/unpublish, regenerate slug.
artifactApiRoutes.put('/:id/visibility', (c) => notImplemented(c, 'set_visibility'));

// Linked datasets (spec §6).
artifactApiRoutes.post('/:id/datasets', (c) => notImplemented(c, 'link_dataset'));
artifactApiRoutes.delete('/:id/datasets/:datasetId', (c) => notImplemented(c, 'unlink_dataset'));
