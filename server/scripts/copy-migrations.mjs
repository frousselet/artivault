// Copies SQL migration files into the build output, since `tsc` only emits JS.
// Keeps migrations resolvable from `import.meta.dirname` in both dev and prod.
import { cpSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const from = resolve(here, '../src/db/migrations');
const to = resolve(here, '../dist/db/migrations');

if (!existsSync(from)) {
  console.error(`No migrations directory at ${from}`);
  process.exit(1);
}

cpSync(from, to, { recursive: true });
console.log(`Copied migrations -> ${to}`);
