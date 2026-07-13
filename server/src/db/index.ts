import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../config/env.js';

export type Db = Database.Database;

let db: Db | undefined;

/** Open a database at `path`, applying the connection pragmas Artivault relies on. */
export function openDb(path: string): Db {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const connection = new Database(path);
  // foreign_keys must be set outside a transaction, so we do it at connection open.
  connection.pragma('journal_mode = WAL');
  connection.pragma('foreign_keys = ON');
  connection.pragma('busy_timeout = 5000');
  connection.pragma('synchronous = NORMAL');
  return connection;
}

/** Process-wide singleton connection to the main database (spec §6). */
export function getDb(): Db {
  if (!db) {
    db = openDb(config.databasePath);
  }
  return db;
}

export function closeDb(): void {
  db?.close();
  db = undefined;
}
