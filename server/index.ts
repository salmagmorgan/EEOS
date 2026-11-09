import fs from 'node:fs';
import { createApp } from './app';
import { createUser, userCount, validatePassword } from './auth';
import { config } from './config';
import { isEmpty, loadSeed, openDb } from './db';

const cfg = config();
const db = openDb(cfg.databasePath);

if (isEmpty(db)) {
  if (fs.existsSync(cfg.seedPath)) {
    loadSeed(db, JSON.parse(fs.readFileSync(cfg.seedPath, 'utf8')));
    console.log(`Empty database — loaded seed ${cfg.seedPath}`);
  } else console.warn(`Empty database and no seed at ${cfg.seedPath}`);
}

if (userCount(db) === 0) {
  if (!cfg.adminEmail || !cfg.adminPassword) {
    console.error('No users exist yet. Set ADMIN_EMAIL and ADMIN_PASSWORD (see .env.example) and restart, or run `npm run create-user`.');
    process.exit(1);
  }
  const problem = validatePassword(cfg.adminPassword);
  if (problem) { console.error('ADMIN_PASSWORD: ' + problem); process.exit(1); }
  createUser(db, { name: cfg.adminName, email: cfg.adminEmail, role: 'admin', password: cfg.adminPassword });
  console.log(`Created admin account ${cfg.adminEmail}`);
}

const app = createApp(db, cfg);
app.listen(cfg.port, () => {
  console.log(`EEOS API listening on http://localhost:${cfg.port}${fs.existsSync(cfg.staticDir) && process.env.NODE_ENV === 'production' ? ' (serving the web app)' : ''}`);
  if (!cfg.anthropicApiKey) console.log('AI Copilot disabled — set ANTHROPIC_API_KEY to enable it.');
});
