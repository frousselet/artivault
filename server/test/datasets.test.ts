import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import Database from 'better-sqlite3';

process.env.NODE_ENV = 'test';
process.env.PUBLIC_BASE_URL = 'http://localhost:8787';
process.env.EXPECTED_ORIGIN = 'http://localhost:8787';
process.env.RP_ID = 'localhost';
process.env.DATABASE_FILE = ':memory:';
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'artivault-ds-'));
process.env.SESSION_SECRET = 'test-secret-session-0000000000000000';
process.env.CSRF_SECRET = 'test-secret-csrf-0000000000000000';
process.env.CAPABILITY_TOKEN_SECRET = 'test-secret-capability-0000000000';
process.env.OAUTH_TOKEN_SECRET = 'test-secret-oauth-00000000000000000';

const { buildApp } = await import('../src/app.js');
const { getDb } = await import('../src/db/index.js');
const { runMigrations } = await import('../src/db/migrate.js');
const { createSession } = await import('../src/auth/session.js');
const { createUser } = await import('../src/services/users.js');
const { createArtifact } = await import('../src/services/artifacts.js');
const { setShare } = await import('../src/services/shares.js');
const { datasetAccess } = await import('../src/services/authorization.js');
const ds = await import('../src/services/datasets.js');

runMigrations(getDb());
const app = buildApp();
const owner = createUser({ email: 'owner@ds.com', displayName: 'Owner' });
const other = createUser({ email: 'other@ds.com', displayName: 'Other' });

function sqliteBuffer(): Buffer {
  const mem = new Database(':memory:');
  mem.exec("CREATE TABLE t (a INTEGER, b TEXT); INSERT INTO t VALUES (1, 'x'), (2, 'y')");
  const buf = mem.serialize();
  mem.close();
  return buf;
}

test('inline dataset create / update / versioning', () => {
  const d = ds.createInlineDataset({
    ownerId: owner.id,
    name: 'D',
    format: 'csv',
    content: 'a,b\n1,2',
    editorId: owner.id,
    editorKind: 'user',
  });
  assert.equal(d.storage, 'inline');
  assert.equal(d.current_version, 1);

  const u = ds.updateInlineDataset({
    datasetId: d.id,
    baseVersion: 1,
    content: 'a,b\n3,4',
    editorId: owner.id,
    editorKind: 'user',
  });
  assert.equal(u.current_version, 2);
  assert.throws(
    () =>
      ds.updateInlineDataset({
        datasetId: d.id,
        baseVersion: 1,
        content: 'stale',
        editorId: owner.id,
        editorKind: 'user',
      }),
    /stale write/,
  );
  assert.equal(ds.listDatasetVersions(d.id).length, 2);
});

test('SQLite dataset upload + read-only query with guards', () => {
  const d = ds.createSqliteDataset({
    ownerId: owner.id,
    name: 'S',
    data: sqliteBuffer(),
    editorId: owner.id,
    editorKind: 'user',
  });
  assert.equal(d.storage, 'sqlite_file');

  const res = ds.queryDataset(d, 'SELECT a, b FROM t ORDER BY a');
  assert.deepEqual(res.columns, ['a', 'b']);
  assert.equal(res.rows.length, 2);

  assert.throws(() => ds.queryDataset(d, 'DELETE FROM t'), /only SELECT/);
  assert.throws(() => ds.queryDataset(d, 'SELECT 1; DROP TABLE t'), /single statement/);
});

test('a non-SQLite upload is rejected', () => {
  assert.throws(
    () =>
      ds.createSqliteDataset({
        ownerId: owner.id,
        name: 'bad',
        data: Buffer.from('this is not a sqlite file'),
        editorId: owner.id,
        editorKind: 'user',
      }),
    /not a valid SQLite/,
  );
});

test('linking an artifact propagates its access to the dataset (spec §8)', () => {
  const d = ds.createInlineDataset({
    ownerId: owner.id,
    name: 'Data',
    format: 'json',
    content: '[]',
    editorId: owner.id,
    editorKind: 'user',
  });
  const a = createArtifact({
    ownerId: owner.id,
    name: 'Art',
    kind: 'html',
    content: '<p>x</p>',
    editorId: owner.id,
    editorKind: 'user',
  });
  assert.equal(datasetAccess(d, other.id), null);

  ds.linkDataset(a.id, d.id);
  setShare('artifact', a.id, other.id, 'read', owner.id);
  assert.equal(datasetAccess(d, other.id), 'read');

  setShare('artifact', a.id, other.id, 'write', owner.id);
  assert.equal(datasetAccess(d, other.id), 'write');
});

test('the dataset API requires auth; owner can create inline over HTTP', async () => {
  const anon = await app.request('/api/datasets');
  assert.equal(anon.status, 401);

  const res = await app.request('/api/datasets', {
    method: 'POST',
    headers: {
      cookie: `av_session=${createSession(owner.id, 't')}; av_csrf=t`,
      'x-csrf-token': 't',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ name: 'HD', format: 'csv', content: 'a\n1' }),
  });
  assert.equal(res.status, 201);
  const body = (await res.json()) as { dataset: { storage: string; currentVersion: number } };
  assert.equal(body.dataset.storage, 'inline');
  assert.equal(body.dataset.currentVersion, 1);
});
