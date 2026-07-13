import type { EditorKind } from '../types/domain.js';

/** Who authored a version, recorded on every immutable snapshot (spec §9). */
export interface EditorRef {
  editorId: string | null;
  editorKind: EditorKind;
}

// TODO(spec §9): shared versioning helpers —
//   - appendArtifactVersion / appendDatasetVersion: write an immutable snapshot
//     with the editor, note and timestamp, then advance current_version
//   - restoreVersion: promote a past version to a new head (append-only; never erase)
//   - deleteVersion: any version except the current head; for sqlite_file dataset
//     versions, also delete the referenced snapshot file
