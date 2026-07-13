import { getDb } from '../db/index.js';
import type { Dataset } from '../types/domain.js';

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

/** Datasets linked to an artifact (spec §6 link table). */
export function getLinkedDatasets(artifactId: string): Dataset[] {
  return getDb()
    .prepare(
      `SELECT d.* FROM datasets d
       JOIN artifact_datasets ad ON ad.dataset_id = d.id
       WHERE ad.artifact_id = ?`,
    )
    .all(artifactId) as Dataset[];
}

// TODO(spec §9, §12, §14): write paths still to build —
//   - create/update datasets, choosing inline vs sqlite_file storage by size
//   - full file-snapshot versioning for sqlite_file datasets (delete removes the file)
//   - read-only SQL query endpoint for sqlite_file datasets: open with query_only,
//     enforce a statement timeout and caps on returned rows/bytes (spec §12)
//   - restoreVersion / deleteVersion
