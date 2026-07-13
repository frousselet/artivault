// Small fetch wrapper: obtains a CSRF token before writes (spec §10) and
// surfaces server error messages.

let csrfToken: string | null = null;

async function ensureCsrf(): Promise<string> {
  if (csrfToken) return csrfToken;
  const res = await fetch('/api/auth/csrf', { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error('Could not obtain a CSRF token.');
  const data = (await res.json()) as { csrfToken: string };
  csrfToken = data.csrfToken;
  return csrfToken;
}

async function toError(res: Response): Promise<Error> {
  let detail = `HTTP ${res.status}`;
  try {
    const data = (await res.json()) as { message?: string; error?: string };
    detail = data.message ?? data.error ?? detail;
  } catch {
    // non-JSON error body
  }
  return new Error(detail);
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { accept: 'application/json' } });
  if (!res.ok) throw await toError(res);
  return (await res.json()) as T;
}

type WriteMethod = 'POST' | 'PATCH' | 'PUT' | 'DELETE';

async function write<T>(method: WriteMethod, path: string, body?: unknown): Promise<T> {
  const token = await ensureCsrf();
  const headers: Record<string, string> = { accept: 'application/json', 'x-csrf-token': token };
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(path, init);
  if (!res.ok) throw await toError(res);
  return (await res.json()) as T;
}

export const apiPost = <T>(path: string, body?: unknown): Promise<T> =>
  write<T>('POST', path, body ?? {});
export const apiPatch = <T>(path: string, body?: unknown): Promise<T> =>
  write<T>('PATCH', path, body ?? {});
export const apiPut = <T>(path: string, body?: unknown): Promise<T> =>
  write<T>('PUT', path, body ?? {});
export const apiDelete = <T>(path: string): Promise<T> => write<T>('DELETE', path);
