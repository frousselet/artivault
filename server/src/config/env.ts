import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';

/** A directory is the repo root if it holds `.git` or a workspaces `package.json`. */
function isRepoRoot(dir: string): boolean {
  if (existsSync(join(dir, '.git'))) return true;
  const pkg = join(dir, 'package.json');
  if (existsSync(pkg)) {
    try {
      const parsed = JSON.parse(readFileSync(pkg, 'utf8')) as { workspaces?: unknown };
      if (parsed.workspaces) return true;
    } catch {
      // ignore a malformed package.json and keep walking up
    }
  }
  return false;
}

/**
 * Locate the repo root by walking up from `startDir`. Used to anchor `.env`
 * loading and relative data paths so they resolve identically whether a process
 * starts at the repo root or inside a workspace such as `server/`.
 */
function findRepoRoot(startDir: string): string {
  let dir = startDir;
  for (;;) {
    if (isRepoRoot(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) return startDir; // no marker found; fall back to cwd
    dir = parent;
  }
}

const repoRoot = findRepoRoot(process.cwd());

// Load a local .env from the repo root if present (no dependency needed; Node ≥ 20.12).
// Skipped under NODE_ENV=test so tests fully control the environment.
try {
  const envFile = join(repoRoot, '.env');
  if (process.env.NODE_ENV !== 'test' && existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }
} catch {
  // loadEnvFile throws if the file disappears between the check and the call.
}

/** Parse booleans from env strings without the `Boolean('false') === true` footgun. */
const envBool = (defaultValue: boolean) =>
  z.preprocess((v) => {
    if (typeof v !== 'string') return v;
    const s = v.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(s)) return true;
    if (['0', 'false', 'no', 'off', ''].includes(s)) return false;
    return v;
  }, z.boolean().default(defaultValue));

const secret = z.string().min(16, 'must be at least 16 characters');

const EnvSchema = z.object({
  PUBLIC_BASE_URL: z.string().url(),
  EXPECTED_ORIGIN: z.string().url(),
  RP_ID: z.string().min(1),
  RP_NAME: z.string().min(1).default('Artivault'),

  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().positive().max(65535).default(8787),
  TRUST_PROXY: envBool(false),

  DATA_DIR: z.string().min(1).default('./data'),
  DATABASE_FILE: z.string().min(1).default('artivault.db'),

  // Directory of the built SPA (web/dist). When present, the server serves it at
  // the root with an index.html fallback so the GUI and API share one origin.
  WEB_DIST_DIR: z.string().min(1).optional(),

  SESSION_SECRET: secret,
  CSRF_SECRET: secret,
  CAPABILITY_TOKEN_SECRET: secret,
  OAUTH_TOKEN_SECRET: secret,

  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(1_209_600),
  LOCK_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  LOCK_HEARTBEAT_SECONDS: z.coerce.number().int().positive().default(60),
  CAPABILITY_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(120),
  INVITATION_TTL_SECONDS: z.coerce.number().int().positive().default(604_800), // 7 days
  OAUTH_ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(3600), // 1 hour
  OAUTH_REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(7_776_000), // 90 days
  DATASET_QUERY_MAX_ROWS: z.coerce.number().int().positive().default(1000),
  DATASET_QUERY_MAX_BYTES: z.coerce.number().int().positive().default(1_000_000),

  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

const env = parsed.data;

// Anchor a relative DATA_DIR to the repo root so the database path is identical
// regardless of the process's working directory.
const dataDir = isAbsolute(env.DATA_DIR) ? env.DATA_DIR : resolve(repoRoot, env.DATA_DIR);

// `:memory:` is a valid SQLite target (used by tests); leave it untouched.
const databasePath =
  env.DATABASE_FILE === ':memory:'
    ? ':memory:'
    : isAbsolute(env.DATABASE_FILE)
      ? env.DATABASE_FILE
      : join(dataDir, env.DATABASE_FILE);

// Built SPA directory. Defaults to `web/dist` at the repo root; overridable so a
// container can point at wherever the assets were copied.
const webDistDir = env.WEB_DIST_DIR
  ? isAbsolute(env.WEB_DIST_DIR)
    ? env.WEB_DIST_DIR
    : resolve(repoRoot, env.WEB_DIST_DIR)
  : resolve(repoRoot, 'web', 'dist');

// Origins accepted for WebAuthn ceremonies (and CSRF). In development we also
// accept the Vite dev server origin so the passkey flow works when the GUI is
// served by Vite (:5173) and proxied to the API.
const expectedOrigins = Array.from(
  new Set([
    env.EXPECTED_ORIGIN,
    ...(env.NODE_ENV === 'development' ? ['http://localhost:5173', 'http://127.0.0.1:5173'] : []),
  ]),
);

export const config = Object.freeze({
  ...env,
  repoRoot,
  dataDir,
  datasetsDir: join(dataDir, 'datasets'),
  databasePath,
  webDistDir,
  expectedOrigins,
  isProduction: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
  /** Session/CSRF cookies are Secure when the public origin is HTTPS. */
  cookieSecure: env.EXPECTED_ORIGIN.startsWith('https://'),
});

export type Config = typeof config;
