import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from './index.js';
import { closeDb, getDb } from './index.js';

const migrationsDir = join(import.meta.dirname, 'migrations');

/**
 * Apply every `NNNN_*.sql` migration not yet recorded in `schema_migrations`,
 * each inside its own transaction. Idempotent: already-applied files are skipped.
 */
export function runMigrations(db: Db): { applied: string[] } {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name       TEXT PRIMARY KEY,
       applied_at INTEGER NOT NULL DEFAULT (unixepoch())
     )`,
  );

  const done = new Set<string>(
    db
      .prepare('SELECT name FROM schema_migrations')
      .all()
      .map((r) => (r as { name: string }).name),
  );

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const applied: string[] = [];
  const record = db.prepare('INSERT INTO schema_migrations (name) VALUES (?)');

  for (const file of files) {
    if (done.has(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      record.run(file);
    })();
    applied.push(file);
  }

  return { applied };
}

// Allow running directly: `npm run migrate`.
if (import.meta.filename === process.argv[1]) {
  const db = getDb();
  const { applied } = runMigrations(db);
  if (applied.length === 0) {
    console.log('Database is up to date; no migrations to apply.');
  } else {
    console.log(`Applied ${applied.length} migration(s):\n  ${applied.join('\n  ')}`);
  }
  closeDb();
}
