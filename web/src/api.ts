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

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { accept: 'application/json' } });
  if (!res.ok) throw await toError(res);
  return (await res.json()) as T;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const token = await ensureCsrf();
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': token },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw await toError(res);
  return (await res.json()) as T;
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
