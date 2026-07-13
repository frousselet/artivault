import { Hono } from 'hono';
import { requireAuth } from '../../auth/session.js';
import { searchUsers } from '../../services/users.js';

// Authenticated user lookup for share pickers (spec §8). Returns a capped list of
// matches by email or display name; excludes the caller and disabled accounts.
export const userApiRoutes = new Hono();

userApiRoutes.get('/search', (c) => {
  const { user } = requireAuth(c);
  const q = (c.req.query('q') ?? '').trim();
  if (q.length < 1) return c.json({ users: [] });
  const users = searchUsers(q, user.id, 8).map((u) => ({
    id: u.id,
    email: u.email,
    displayName: u.display_name,
  }));
  return c.json({ users });
});
