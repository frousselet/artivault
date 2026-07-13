import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/** Error carrying an HTTP status, translated to a JSON body by the global handler. */
export class AppError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: string;
  constructor(status: ContentfulStatusCode, code: string, message: string) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
  }
}

/** Standard placeholder response for routes that are wired but not yet built. */
export function notImplemented(c: Context, feature: string) {
  return c.json({ error: 'not_implemented', feature }, 501);
}

export const unauthorized = (message = 'authentication required') =>
  new AppError(401, 'unauthorized', message);
export const forbidden = (message = 'insufficient permission') =>
  new AppError(403, 'forbidden', message);
export const notFound = (message = 'not found') => new AppError(404, 'not_found', message);
export const conflict = (message: string) => new AppError(409, 'conflict', message);
