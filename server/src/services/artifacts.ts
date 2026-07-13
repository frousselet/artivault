import { getDb } from '../db/index.js';
import type { Artifact } from '../types/domain.js';

export function getArtifactBySlug(slug: string): Artifact | null {
  return (
    (getDb().prepare('SELECT * FROM artifacts WHERE slug = ?').get(slug) as Artifact | undefined) ??
    null
  );
}

export function getArtifactById(id: string): Artifact | null {
  return (
    (getDb().prepare('SELECT * FROM artifacts WHERE id = ?').get(id) as Artifact | undefined) ??
    null
  );
}

// TODO(spec §8, §9, §14, §15): write paths still to build —
//   - createArtifact: assign a slug (generateSlug), write version 1
//   - updateArtifact: require the lock (services/locks) + optimistic base-version
//     check, append an immutable version, bump current_version and updated_at
//   - setVisibility: publish/unpublish, optionally regenerate the slug
//   - deleteArtifact, restoreVersion, deleteVersion
//   - linkDataset / unlinkDataset
// Every write must call recordAudit and respect the locking rules.
