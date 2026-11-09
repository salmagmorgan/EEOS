/* Replace all business data in the database with a seed file (users are kept).
   Usage: npm run seed -- [path/to/seed.json]   (defaults to SEED_PATH, then the demo seed) */
import fs from 'node:fs';
import { config } from '../config';
import { loadSeed, openDb } from '../db';

const cfg = config();
const file = process.argv[2] ?? cfg.seedPath;
const seed = JSON.parse(fs.readFileSync(file, 'utf8'));
loadSeed(openDb(cfg.databasePath), seed);
console.log(`Loaded ${file} into ${cfg.databasePath}: ${seed.talents.length} talents, ${seed.engagements.length} engagements.`);
