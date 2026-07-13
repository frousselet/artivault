import { apiGet } from './api.js';

export interface UserHit {
  id: string;
  email: string;
  displayName: string;
}

export const searchUsers = (q: string): Promise<UserHit[]> =>
  apiGet<{ users: UserHit[] }>(`/api/users/search?q=${encodeURIComponent(q)}`).then((r) => r.users);
