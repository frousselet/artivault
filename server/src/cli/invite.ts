import { parseArgs } from 'node:util';
import { closeDb, getDb } from '../db/index.js';
import { runMigrations } from '../db/migrate.js';
import { countCredentialsByUser } from '../services/credentials.js';
import { buildInviteUrl, createInvitation } from '../services/invitations.js';
import { getUserByEmail } from '../services/users.js';

// Regenerate a single-use invitation link for an existing account that has not
// registered a passkey yet (e.g. the previous link expired or was lost).

const USAGE = 'Usage: npx tsx server/src/cli/invite.ts --email <email>';

const { values } = parseArgs({ options: { email: { type: 'string' } } });

function fail(message: string): never {
  console.error(`${message}\n${USAGE}`);
  process.exit(1);
}

const email = values.email?.trim().toLowerCase();
if (!email) fail('Missing --email.');

// Make sure the schema exists (safe if already migrated).
runMigrations(getDb());

// Suggest the sibling command in the form that works here: the built JS when run
// from dist (Docker/production), or the npm script when run from source (dev).
const createCmd = import.meta.url.includes('/dist/')
  ? 'node server/dist/cli/create-user.js'
  : 'npm run create-user --';

const user = getUserByEmail(email);
if (!user) {
  fail(`No user with email ${email}.\nCreate one with:  ${createCmd} --email ${email}`);
}

// An invitation only sets up the FIRST passkey; the server rejects it otherwise,
// so a link for an already-registered account would be dead on arrival.
if (countCredentialsByUser(user.id) > 0) {
  fail(
    `${email} already has a passkey, so an invitation would be rejected.\n` +
      'To add another device, sign in and use Account → Add passkey.',
  );
}

const { token, invitation } = createInvitation(user.id, user.id);
const expires = new Date(invitation.expires_at * 1000).toISOString();

console.log(`Fresh invitation for ${email} (role: ${user.role}) — single-use, expires ${expires}:`);
console.log(`\n  ${buildInviteUrl(token)}\n`);
console.log('Open it in a browser to register the passkey for this account and sign in.');

closeDb();
