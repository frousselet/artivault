import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';
import type {
  Artifact,
  ArtifactKind,
  ArtifactVersion,
  EditorKind,
  Visibility,
} from '../types/domain.js';
import { conflict, notFound } from '../util/http.js';
import { generateSlug } from '../util/slug.js';
import { nowSeconds } from '../util/time.js';

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

export interface ArtifactWithShareCount extends Artifact {
  share_count: number;
}

/** Artifacts owned by or shared with a user, newest first (spec §7, §13). */
export function listArtifactsForUser(userId: string): ArtifactWithShareCount[] {
  return getDb()
    .prepare(
      `SELECT DISTINCT a.*,
              (SELECT COUNT(*) FROM shares s2
                 WHERE s2.resource_kind = 'artifact' AND s2.resource_id = a.id) AS share_count
       FROM artifacts a
       LEFT JOIN shares s
         ON s.resource_kind = 'artifact' AND s.resource_id = a.id AND s.grantee_id = ?
       WHERE a.owner_id = ? OR s.id IS NOT NULL
       ORDER BY a.updated_at DESC`,
    )
    .all(userId, userId) as ArtifactWithShareCount[];
}

export function listArtifactVersions(artifactId: string): ArtifactVersion[] {
  return getDb()
    .prepare('SELECT * FROM artifact_versions WHERE artifact_id = ? ORDER BY version DESC')
    .all(artifactId) as ArtifactVersion[];
}

export interface CreateArtifactInput {
  ownerId: string;
  name: string;
  kind: ArtifactKind;
  content: string;
  editorId: string;
  editorKind: EditorKind;
  note?: string | null;
}

/** Create an artifact with its first version (spec §9). */
export function createArtifact(input: CreateArtifactInput): Artifact {
  const db = getDb();
  const id = randomUUID();
  const slug = generateSlug();
  const now = nowSeconds();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO artifacts
         (id, owner_id, slug, name, kind, content, visibility, current_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'private', 1, ?, ?)`,
    ).run(id, input.ownerId, slug, input.name, input.kind, input.content, now, now);
    db.prepare(
      `INSERT INTO artifact_versions (artifact_id, version, content, editor_id, editor_kind, note)
       VALUES (?, 1, ?, ?, ?, ?)`,
    ).run(id, input.content, input.editorId, input.editorKind, input.note ?? null);
  })();
  return getArtifactById(id) as Artifact;
}

export interface UpdateArtifactInput {
  artifactId: string;
  baseVersion: number;
  content?: string;
  name?: string;
  kind?: ArtifactKind;
  editorId: string;
  editorKind: EditorKind;
  note?: string | null;
}

/**
 * Append a new version and advance the head. Enforces the optimistic base-version
 * check (spec §9); lock enforcement is the caller's responsibility (spec §8).
 */
export function updateArtifact(input: UpdateArtifactInput): Artifact {
  const db = getDb();
  db.transaction(() => {
    const a = getArtifactById(input.artifactId);
    if (!a) throw notFound('artifact not found');
    if (a.current_version !== input.baseVersion) {
      throw conflict(
        `stale write: base version ${input.baseVersion} no longer matches current ${a.current_version}`,
      );
    }
    const version = a.current_version + 1;
    const content = input.content ?? a.content;
    const name = input.name ?? a.name;
    const kind = input.kind ?? a.kind;
    db.prepare(
      'UPDATE artifacts SET content = ?, name = ?, kind = ?, current_version = ?, updated_at = ? WHERE id = ?',
    ).run(content, name, kind, version, nowSeconds(), a.id);
    db.prepare(
      `INSERT INTO artifact_versions (artifact_id, version, content, editor_id, editor_kind, note)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(a.id, version, content, input.editorId, input.editorKind, input.note ?? null);
  })();
  return getArtifactById(input.artifactId) as Artifact;
}

export function setArtifactVisibility(
  id: string,
  visibility: Visibility,
  actorId: string,
): Artifact {
  const now = nowSeconds();
  getDb()
    .prepare(
      'UPDATE artifacts SET visibility = ?, published_at = ?, published_by = ?, updated_at = ? WHERE id = ?',
    )
    .run(
      visibility,
      visibility === 'public' ? now : null,
      visibility === 'public' ? actorId : null,
      now,
      id,
    );
  return getArtifactById(id) as Artifact;
}

/** Delete an artifact and its (non-FK) share and lock rows (spec §7). */
export function deleteArtifact(id: string): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare("DELETE FROM shares WHERE resource_kind = 'artifact' AND resource_id = ?").run(id);
    db.prepare("DELETE FROM locks WHERE resource_kind = 'artifact' AND resource_id = ?").run(id);
    db.prepare('DELETE FROM artifacts WHERE id = ?').run(id);
  })();
}
