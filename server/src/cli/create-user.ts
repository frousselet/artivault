import { parseArgs } from 'node:util';
import { closeDb, getDb } from '../db/index.js';
import { runMigrations } from '../db/migrate.js';
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

const email = values.email?.trim();
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
  console.error(`A user with email ${email} already exists.`);
  closeDb();
  process.exit(1);
}

const user = createUser({ email, displayName, role });

console.log('Created user:');
console.log(
  JSON.stringify(
    { id: user.id, email: user.email, display_name: user.display_name, role: user.role },
    null,
    2,
  ),
);
console.log(
  '\nNote: passkey registration/login is not implemented yet (spec §10), so this\n' +
    'account cannot sign in through the GUI until that flow is built. The record and\n' +
    'its role are in place for when it is.',
);

closeDb();
