import { Hono } from 'hono';
import { notImplemented } from '../../util/http.js';

// Admin API (spec §7, §15). Admins manage accounts and the system, and may list
// everyone's resources as METADATA ONLY — never their content.
// TODO(spec §7): guard every route with an admin-role check.
export const adminRoutes = new Hono();

adminRoutes.get('/users', (c) => notImplemented(c, 'admin_list_users'));
adminRoutes.post('/users', (c) => notImplemented(c, 'admin_create_user'));
adminRoutes.patch('/users/:id', (c) => notImplemented(c, 'admin_update_user'));

// Metadata-only listings (no content).
adminRoutes.get('/artifacts', (c) => notImplemented(c, 'admin_list_artifacts_metadata'));
adminRoutes.get('/datasets', (c) => notImplemented(c, 'admin_list_datasets_metadata'));

adminRoutes.get('/audit', (c) => notImplemented(c, 'admin_audit_log'));

adminRoutes.get('/oauth-clients', (c) => notImplemented(c, 'admin_list_oauth_clients'));
adminRoutes.delete('/oauth-clients/:id', (c) => notImplemented(c, 'admin_revoke_oauth_client'));
