/* Vercel serverless entry point: every /api/* request is routed here (see vercel.json). */
import { createApp } from '../server/app.js';
import { bootstrap } from '../server/bootstrap.js';
import { config } from '../server/config.js';
import { openDb } from '../server/db.js';

const cfg = config();
const db = openDb(cfg.databaseUrl, cfg.databaseAuthToken);
// Runs once per cold start; requests wait for it.
const ready = bootstrap(db, cfg);
ready.catch((e) => console.error('EEOS setup failed:', e));

export default createApp(db, cfg, ready);
