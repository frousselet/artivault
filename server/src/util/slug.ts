import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * Generate an unguessable, URL-safe base62 slug (spec §5). Default length 22
 * carries ~131 bits of entropy. Uses rejection sampling to avoid modulo bias.
 */
export function generateSlug(length = 22): string {
  let out = '';
  while (out.length < length) {
    for (const byte of randomBytes(length)) {
      if (byte < 248) {
        // 248 = floor(256 / 62) * 62; reject the biased tail.
        out += ALPHABET[byte % 62];
        if (out.length === length) break;
      }
    }
  }
  return out;
}
