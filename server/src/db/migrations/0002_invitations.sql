-- Invitation links so an admin-created account can set up its first passkey
-- securely: the token (not the email) is the capability. Single-use, expiring.

CREATE TABLE invitations (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,             -- sha256(token), hex
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_invitations_user ON invitations(user_id);
