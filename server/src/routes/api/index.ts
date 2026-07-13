import { Hono } from 'hono';
import { requireCsrf } from '../../auth/csrf.js';
import { adminRoutes } from './admin.js';
import { artifactApiRoutes } from './artifacts.js';
import { authRoutes } from './auth.js';
import { datasetApiRoutes } from './datasets.js';
import { renderDataRoutes } from './render-data.js';

export const apiRoutes = new Hono();

// Capability-token data access is intentionally NOT session/CSRF protected
// (spec §11): the token is the grant. Mount it before the CSRF guard.
apiRoutes.route('/render-data', renderDataRoutes);

// Every other state-changing /api request requires the CSRF token (spec §10).
apiRoutes.use('*', requireCsrf);

apiRoutes.route('/auth', authRoutes);
apiRoutes.route('/artifacts', artifactApiRoutes);
apiRoutes.route('/datasets', datasetApiRoutes);
apiRoutes.route('/admin', adminRoutes);
