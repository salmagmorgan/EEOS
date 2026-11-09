/* Replace all business data in the database with a seed file (users are kept).
   Usage: npm run seed -- [path/to/seed.json]   (defaults to SEED_PATH, then the demo seed) */
import fs from 'node:fs';
import { config } from '../config.js';
import { loadSeed, migrate, openDb } from '../db.js';

const cfg = config();
const file = process.argv[2] ?? cfg.seedPath;
// Works against the local file or, with DATABASE_URL/TURSO_DATABASE_URL set, against Turso.
const seed = JSON.parse(fs.readFileSync(file, 'utf8'));
const db = openDb(cfg.databaseUrl, cfg.databaseAuthToken);
await migrate(db);
await loadSeed(db, seed);
console.log(`Loaded ${file} into ${cfg.databaseUrl}: ${seed.talents.length} talents, ${seed.engagements.length} engagements.`);
