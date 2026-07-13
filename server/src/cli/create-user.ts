import { parseArgs } from 'node:util';
import { closeDb, getDb } from '../db/index.js';
import { runMigrations } from '../db/migrate.js';
import { buildInviteUrl, createInvitation } from '../services/invitations.js';
import { createUser, getUserByEmail } from '../services/users.js';
import type { Role } from '../types/domain.js';

const USAGE =
  'Usage: npx tsx server/src/cli/create-user.ts --email <email> [--name "<name>"] [--role admin|user] [--admin]';

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    role: { type: 'string' },
    admin: { type: 'boolean' },
  },
});

function fail(message: string): never {
  console.error(`${message}\n${USAGE}`);
  process.exit(1);
}

const email = values.email?.trim().toLowerCase();
if (!email) fail('Missing --email.');
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail(`Invalid email: ${email}`);

const displayName = values.name?.trim() || email.split('@')[0] || email;

let role: Role | undefined;
if (values.admin) {
  role = 'admin';
} else if (values.role !== undefined) {
  if (values.role !== 'admin' && values.role !== 'user') {
    fail(`Invalid --role: ${values.role} (expected 'admin' or 'user')`);
  }
  role = values.role;
}

// Make sure the schema exists (safe if already migrated).
runMigrations(getDb());

if (getUserByEmail(email)) {
  fail(
    `A user with email ${email} already exists.\n` +
      `Regenerate its invitation link with:  npm run invite -- --email ${email}`,
  );
}

const user = createUser({ email, displayName, role });

// A new account has no passkey yet, and open registration is closed once any user
// exists — so mint a single-use invitation link. Opening it is how this account
// registers its first passkey and signs in.
const { token, invitation } = createInvitation(user.id, user.id);
const expires = new Date(invitation.expires_at * 1000).toISOString();

console.log(`Created ${user.role} account ${email}.`);
console.log(`\nInvitation link — single-use, expires ${expires}:\n\n  ${buildInviteUrl(token)}\n`);
console.log('Open it in a browser to register the passkey for this account and sign in.');

closeDb();
