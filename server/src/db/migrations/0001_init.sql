-- Artivault initial schema (spec §6).
-- Timestamps are INTEGER unix seconds. Ids default to random 128-bit hex so raw
-- inserts work, but the application may supply its own ids.
-- `foreign_keys` is enabled on the connection (see db/index.ts), not here, because
-- the pragma is a no-op inside the migration transaction.

CREATE TABLE users (
  id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  email        TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  disabled     INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0, 1)),
  created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);

-- One passkey per device (spec §6, §10).
CREATE TABLE credentials (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,            -- base64url-encoded credential id
  public_key    BLOB NOT NULL,                   -- COSE public key
  counter       INTEGER NOT NULL DEFAULT 0,
  transports    TEXT,                            -- JSON array of transports
  device_name   TEXT,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  last_used_at  INTEGER
);
CREATE INDEX idx_credentials_user ON credentials(user_id);

CREATE TABLE artifacts (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  owner_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('html', 'svg', 'markdown')),
  content         TEXT NOT NULL DEFAULT '',
  visibility      TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public')),
  published_at    INTEGER,
  published_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  current_version INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_artifacts_owner ON artifacts(owner_id);
CREATE INDEX idx_artifacts_visibility ON artifacts(visibility);

CREATE TABLE artifact_versions (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  version     INTEGER NOT NULL,
  content     TEXT NOT NULL,
  editor_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  editor_kind TEXT NOT NULL CHECK (editor_kind IN ('user', 'agent')),
  note        TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (artifact_id, version)
);

CREATE TABLE datasets (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  owner_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  storage         TEXT NOT NULL CHECK (storage IN ('inline', 'sqlite_file')),
  format          TEXT NOT NULL CHECK (format IN ('csv', 'json', 'sqlite')),
  content         TEXT,                          -- inline datasets only
  file_path       TEXT,                          -- sqlite_file datasets only
  current_version INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_datasets_owner ON datasets(owner_id);

CREATE TABLE dataset_versions (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  dataset_id  TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  version     INTEGER NOT NULL,
  content     TEXT,                              -- inline snapshot
  file_path   TEXT,                              -- sqlite_file snapshot path
  editor_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  editor_kind TEXT NOT NULL CHECK (editor_kind IN ('user', 'agent')),
  note        TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (dataset_id, version)
);

-- Link table: sharing/publishing an artifact propagates access to linked datasets.
CREATE TABLE artifact_datasets (
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  dataset_id  TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (artifact_id, dataset_id)
);
CREATE INDEX idx_artifact_datasets_dataset ON artifact_datasets(dataset_id);

-- Polymorphic resource_id (artifact or dataset); integrity enforced in the app.
CREATE TABLE shares (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  resource_kind TEXT NOT NULL CHECK (resource_kind IN ('artifact', 'dataset')),
  resource_id   TEXT NOT NULL,
  grantee_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission    TEXT NOT NULL CHECK (permission IN ('read', 'write')),
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (resource_kind, resource_id, grantee_id)
);
CREATE INDEX idx_shares_grantee ON shares(grantee_id);
CREATE INDEX idx_shares_resource ON shares(resource_kind, resource_id);

-- At most one active lock per resource (spec §8).
CREATE TABLE locks (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  resource_kind TEXT NOT NULL CHECK (resource_kind IN ('artifact', 'dataset')),
  resource_id   TEXT NOT NULL,
  holder_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  holder_kind   TEXT NOT NULL CHECK (holder_kind IN ('user', 'agent')),
  acquired_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at    INTEGER NOT NULL,
  UNIQUE (resource_kind, resource_id)
);
CREATE INDEX idx_locks_expires ON locks(expires_at);

-- Server-side sessions so they can be revoked (spec §10).
CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,                   -- sha256(cookie token), hex
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_agent TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- OAuth 2.1 dynamic client registration (spec §14).
CREATE TABLE oauth_clients (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  client_id     TEXT NOT NULL UNIQUE,
  client_name   TEXT,
  redirect_uris TEXT NOT NULL,                   -- JSON array
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE oauth_tokens (
  id                 TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id          TEXT NOT NULL,
  access_token_hash  TEXT NOT NULL UNIQUE,
  refresh_token_hash TEXT UNIQUE,
  scopes             TEXT,
  expires_at         INTEGER NOT NULL,
  created_at         INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_oauth_tokens_user ON oauth_tokens(user_id);
CREATE INDEX idx_oauth_tokens_client ON oauth_tokens(client_id);

CREATE TABLE audit_log (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  actor_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_kind    TEXT NOT NULL CHECK (actor_kind IN ('user', 'agent')),
  action        TEXT NOT NULL,
  resource_kind TEXT,
  resource_id   TEXT,
  ip            TEXT,
  detail        TEXT,                            -- JSON blob
  at            INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_audit_actor ON audit_log(actor_id);
CREATE INDEX idx_audit_at ON audit_log(at);
CREATE INDEX idx_audit_resource ON audit_log(resource_kind, resource_id);
