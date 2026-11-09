import fs from 'node:fs';
import { createUser, findUserByEmail, userCount, validatePassword } from './auth.js';
import type { Config } from './config.js';
import { type DB, isEmpty, loadSeed, migrate } from './db.js';

export class SetupError extends Error {}

/** Prepare the database: run migrations, load the seed into an empty database, create the first admin.
    Idempotent — runs at every server start and every serverless cold start. */
export async function bootstrap(db: DB, cfg: Config): Promise<void> {
  await migrate(db);
  if (await isEmpty(db)) {
    if (!fs.existsSync(cfg.seedPath)) throw new SetupError(`The database is empty and no seed file was found at ${cfg.seedPath}.`);
    await loadSeed(db, JSON.parse(fs.readFileSync(cfg.seedPath, 'utf8')));
    console.log(`Empty database — loaded seed ${cfg.seedPath}`);
  }
  if ((await userCount(db)) === 0) {
    if (!cfg.adminEmail || !cfg.adminPassword) throw new SetupError('No users exist yet. Set ADMIN_EMAIL and ADMIN_PASSWORD and restart (or redeploy).');
    const problem = validatePassword(cfg.adminPassword);
    if (problem) throw new SetupError('ADMIN_PASSWORD: ' + problem);
    try {
      await createUser(db, { name: cfg.adminName, email: cfg.adminEmail, role: 'admin', password: cfg.adminPassword });
      console.log(`Created admin account ${cfg.adminEmail}`);
    } catch (e) {
      // Another instance may have created it at the same moment.
      if (!(await findUserByEmail(db, cfg.adminEmail))) throw e;
    }
  }
}
