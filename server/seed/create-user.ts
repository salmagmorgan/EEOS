/* Create a user from the command line.
   Usage: npm run create-user -- <email> <role: admin|editor|viewer> "<Full Name>"   (prompts for the password) */
import readline from 'node:readline/promises';
import { createUser, findUserByEmail, validatePassword } from '../auth';
import { config } from '../config';
import { openDb } from '../db';

const [email, role, ...nameParts] = process.argv.slice(2);
if (!email || !['admin', 'editor', 'viewer'].includes(role) || !nameParts.length) {
  console.error('Usage: npm run create-user -- <email> <admin|editor|viewer> "<Full Name>"');
  process.exit(1);
}
const db = openDb(config().databasePath);
if (findUserByEmail(db, email)) { console.error('That email already has an account.'); process.exit(1); }
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const password = await rl.question('Password (min 10 chars): ');
rl.close();
const problem = validatePassword(password);
if (problem) { console.error(problem); process.exit(1); }
const u = createUser(db, { email, role: role as 'admin', name: nameParts.join(' '), password });
console.log(`Created ${u.role} ${u.email}`);
