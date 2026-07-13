import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../config/env.js';
import { getDb } from '../db/index.js';
import type { Artifact, Dataset, DatasetVersion, EditorKind } from '../types/domain.js';
import { AppError, conflict, notFound } from '../util/http.js';
import { generateSlug } from '../util/slug.js';
import { nowSeconds } from '../util/time.js';

// A SQLite file begins with "SQLite format 3" (15 bytes) followed by a NUL byte.
const SQLITE_HEADER = 'SQLite format 3';
function assertSqlite(data: Buffer): void {
  if (
    data.length < 16 ||
    data.subarray(0, 15).toString('latin1') !== SQLITE_HEADER ||
    data[15] !== 0
  ) {
    throw new AppError(400, 'bad_request', 'not a valid SQLite database file');
  }
}

const versionFile = (datasetId: string, version: number): string =>
  join(config.datasetsDir, datasetId, `v${version}.sqlite`);

// --- Reads ---

export function getDatasetBySlug(slug: string): Dataset | null {
  return (
    (getDb().prepare('SELECT * FROM datasets WHERE slug = ?').get(slug) as Dataset | undefined) ??
    null
  );
}

export function getDatasetById(id: string): Dataset | null {
  return (
    (getDb().prepare('SELECT * FROM datasets WHERE id = ?').get(id) as Dataset | undefined) ?? null
  );
}

export interface DatasetWithShareCount extends Dataset {
  share_count: number;
}

export function listDatasetsForUser(userId: string): DatasetWithShareCount[] {
  return getDb()
    .prepare(
      `SELECT DISTINCT d.*,
              (SELECT COUNT(*) FROM shares s2
                 WHERE s2.resource_kind = 'dataset' AND s2.resource_id = d.id) AS share_count
       FROM datasets d
       LEFT JOIN shares s
         ON s.resource_kind = 'dataset' AND s.resource_id = d.id AND s.grantee_id = ?
       WHERE d.owner_id = ? OR s.id IS NOT NULL
       ORDER BY d.updated_at DESC`,
    )
    .all(userId, userId) as DatasetWithShareCount[];
}

export function listDatasetVersions(datasetId: string): DatasetVersion[] {
  return getDb()
    .prepare('SELECT * FROM dataset_versions WHERE dataset_id = ? ORDER BY version DESC')
    .all(datasetId) as DatasetVersion[];
}

function getVersion(datasetId: string, version: number): DatasetVersion | null {
  return (
    (getDb()
      .prepare('SELECT * FROM dataset_versions WHERE dataset_id = ? AND version = ?')
      .get(datasetId, version) as DatasetVersion | undefined) ?? null
  );
}

// --- Create ---

interface Editor {
  editorId: string;
  editorKind: EditorKind;
  note?: string | null;
}

export function createInlineDataset(
  input: Editor & { ownerId: string; name: string; format: 'csv' | 'json'; content: string },
): Dataset {
  const db = getDb();
  const id = randomUUID();
  const slug = generateSlug();
  const now = nowSeconds();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO datasets
         (id, owner_id, slug, name, storage, format, content, current_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'inline', ?, ?, 1, ?, ?)`,
    ).run(id, input.ownerId, slug, input.name, input.format, input.content, now, now);
    db.prepare(
      `INSERT INTO dataset_versions (dataset_id, version, content, editor_id, editor_kind, note)
       VALUES (?, 1, ?, ?, ?, ?)`,
    ).run(id, input.content, input.editorId, input.editorKind, input.note ?? null);
  })();
  return getDatasetById(id) as Dataset;
}

export function createSqliteDataset(
  input: Editor & { ownerId: string; name: string; data: Buffer },
): Dataset {
  assertSqlite(input.data);
  const db = getDb();
  const id = randomUUID();
  const slug = generateSlug();
  const now = nowSeconds();
  const filePath = versionFile(id, 1);
  mkdirSync(join(config.datasetsDir, id), { recursive: true });
  writeFileSync(filePath, input.data);
  db.transaction(() => {
    db.prepare(
      `INSERT INTO datasets
         (id, owner_id, slug, name, storage, format, file_path, current_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'sqlite_file', 'sqlite', ?, 1, ?, ?)`,
    ).run(id, input.ownerId, slug, input.name, filePath, now, now);
    db.prepare(
      `INSERT INTO dataset_versions (dataset_id, version, file_path, editor_id, editor_kind, note)
       VALUES (?, 1, ?, ?, ?, ?)`,
    ).run(id, filePath, input.editorId, input.editorKind, input.note ?? null);
  })();
  return getDatasetById(id) as Dataset;
}

// --- Update (append a version) ---

function guardBaseVersion(d: Dataset, baseVersion: number): void {
  if (d.current_version !== baseVersion) {
    throw conflict(
      `stale write: base version ${baseVersion} no longer matches current ${d.current_version}`,
    );
  }
}

export function updateInlineDataset(
  input: Editor & { datasetId: string; baseVersion: number; content: string; name?: string },
): Dataset {
  const db = getDb();
  db.transaction(() => {
    const d = getDatasetById(input.datasetId);
    if (!d) throw notFound('dataset not found');
    if (d.storage !== 'inline') throw new AppError(400, 'bad_request', 'not an inline dataset');
    guardBaseVersion(d, input.baseVersion);
    const version = d.current_version + 1;
    const name = input.name ?? d.name;
    db.prepare(
      'UPDATE datasets SET content = ?, name = ?, current_version = ?, updated_at = ? WHERE id = ?',
    ).run(input.content, name, version, nowSeconds(), d.id);
    db.prepare(
      `INSERT INTO dataset_versions (dataset_id, version, content, editor_id, editor_kind, note)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(d.id, version, input.content, input.editorId, input.editorKind, input.note ?? null);
  })();
  return getDatasetById(input.datasetId) as Dataset;
}

export function replaceSqliteFile(
  input: Editor & { datasetId: string; baseVersion: number; data: Buffer },
): Dataset {
  assertSqlite(input.data);
  const db = getDb();
  const d = getDatasetById(input.datasetId);
  if (!d) throw notFound('dataset not found');
  if (d.storage !== 'sqlite_file') throw new AppError(400, 'bad_request', 'not a SQLite dataset');
  guardBaseVersion(d, input.baseVersion);
  const version = d.current_version + 1;
  const filePath = versionFile(d.id, version);
  writeFileSync(filePath, input.data);
  db.transaction(() => {
    db.prepare(
      'UPDATE datasets SET file_path = ?, current_version = ?, updated_at = ? WHERE id = ?',
    ).run(filePath, version, nowSeconds(), d.id);
    db.prepare(
      `INSERT INTO dataset_versions (dataset_id, version, file_path, editor_id, editor_kind, note)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(d.id, version, filePath, input.editorId, input.editorKind, input.note ?? null);
  })();
  return getDatasetById(input.datasetId) as Dataset;
}

// --- Versions: restore / delete ---

export function restoreDatasetVersion(
  input: Editor & { datasetId: string; version: number },
): Dataset {
  const d = getDatasetById(input.datasetId);
  if (!d) throw notFound('dataset not found');
  const source = getVersion(input.datasetId, input.version);
  if (!source) throw notFound('version not found');
  if (d.storage === 'inline') {
    return updateInlineDataset({
      datasetId: d.id,
      baseVersion: d.current_version,
      content: source.content ?? '',
      editorId: input.editorId,
      editorKind: input.editorKind,
      note: `restore of v${input.version}`,
    });
  }
  const version = d.current_version + 1;
  const filePath = versionFile(d.id, version);
  if (source.file_path) copyFileSync(source.file_path, filePath);
  const db = getDb();
  db.transaction(() => {
    db.prepare(
      'UPDATE datasets SET file_path = ?, current_version = ?, updated_at = ? WHERE id = ?',
    ).run(filePath, version, nowSeconds(), d.id);
    db.prepare(
      `INSERT INTO dataset_versions (dataset_id, version, file_path, editor_id, editor_kind, note)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      d.id,
      version,
      filePath,
      input.editorId,
      input.editorKind,
      `restore of v${input.version}`,
    );
  })();
  return getDatasetById(d.id) as Dataset;
}

export function deleteDatasetVersion(datasetId: string, version: number): void {
  const d = getDatasetById(datasetId);
  if (!d) throw notFound('dataset not found');
  if (version === d.current_version) {
    throw conflict('cannot delete the current version; restore or replace it first');
  }
  const v = getVersion(datasetId, version);
  if (!v) throw notFound('version not found');
  getDb()
    .prepare('DELETE FROM dataset_versions WHERE dataset_id = ? AND version = ?')
    .run(datasetId, version);
  if (v.file_path) {
    try {
      unlinkSync(v.file_path);
    } catch {
      // snapshot already gone
    }
  }
}

// --- Delete ---

export function deleteDataset(id: string): void {
  const d = getDatasetById(id);
  if (!d) return;
  const db = getDb();
  db.transaction(() => {
    db.prepare("DELETE FROM shares WHERE resource_kind = 'dataset' AND resource_id = ?").run(id);
    db.prepare("DELETE FROM locks WHERE resource_kind = 'dataset' AND resource_id = ?").run(id);
    db.prepare('DELETE FROM datasets WHERE id = ?').run(id); // cascades versions + links
  })();
  if (d.storage === 'sqlite_file') {
    rmSync(join(config.datasetsDir, id), { recursive: true, force: true });
  }
}

// --- Read-only SQL query for SQLite-file datasets (spec §12) ---

export interface QueryResult {
  columns: string[];
  rows: unknown[];
  truncated: boolean;
}

export function queryDataset(dataset: Dataset, sql: string): QueryResult {
  if (dataset.storage !== 'sqlite_file' || !dataset.file_path) {
    throw new AppError(400, 'bad_request', 'querying is only supported for SQLite datasets');
  }
  const trimmed = sql.trim();
  if (!/^(select|with)\b/i.test(trimmed)) {
    throw new AppError(400, 'bad_query', 'only SELECT queries are allowed');
  }
  if (/;\s*\S/.test(trimmed)) {
    throw new AppError(400, 'bad_query', 'only a single statement is allowed');
  }
  // Read-only + query_only make writes impossible. TODO(spec §12): a hard statement
  // timeout (better-sqlite3 is synchronous, so a pathological query can block).
  const ro = new Database(dataset.file_path, { readonly: true });
  try {
    ro.pragma('query_only = ON');
    const stmt = ro.prepare(trimmed);
    const columns = stmt.columns().map((col) => col.name);
    const rows: unknown[] = [];
    let bytes = 0;
    let truncated = false;
    for (const row of stmt.iterate()) {
      rows.push(row);
      bytes += JSON.stringify(row).length;
      if (rows.length >= config.DATASET_QUERY_MAX_ROWS || bytes >= config.DATASET_QUERY_MAX_BYTES) {
        truncated = true;
        break;
      }
    }
    return { columns, rows, truncated };
  } finally {
    ro.close();
  }
}

// --- Links (artifact_datasets, spec §6) ---

export function getLinkedDatasets(artifactId: string): Dataset[] {
  return getDb()
    .prepare(
      `SELECT d.* FROM datasets d
       JOIN artifact_datasets ad ON ad.dataset_id = d.id
       WHERE ad.artifact_id = ?
       ORDER BY d.name`,
    )
    .all(artifactId) as Dataset[];
}

export function getArtifactsLinkingDataset(datasetId: string): Artifact[] {
  return getDb()
    .prepare(
      `SELECT a.* FROM artifacts a
       JOIN artifact_datasets ad ON ad.artifact_id = a.id
       WHERE ad.dataset_id = ?`,
    )
    .all(datasetId) as Artifact[];
}

export function linkDataset(artifactId: string, datasetId: string): void {
  getDb()
    .prepare('INSERT OR IGNORE INTO artifact_datasets (artifact_id, dataset_id) VALUES (?, ?)')
    .run(artifactId, datasetId);
}

export function unlinkDataset(artifactId: string, datasetId: string): boolean {
  return (
    getDb()
      .prepare('DELETE FROM artifact_datasets WHERE artifact_id = ? AND dataset_id = ?')
      .run(artifactId, datasetId).changes > 0
  );
}
