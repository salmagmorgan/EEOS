/* Vercel serverless entry point: every /api/* request is routed here (see vercel.json). */
import { createApp, readyGate } from '../server/app.js';
import { bootstrap } from '../server/bootstrap.js';
import { config } from '../server/config.js';
import { openDb } from '../server/db.js';

const cfg = config();
const db = openDb(cfg.databaseUrl, cfg.databaseAuthToken);
// Setup runs at the first request of each cold start; requests wait for it. If it fails (e.g. the
// database is waking up), the error is reported and the next request tries again.
const ready = readyGate(() => bootstrap(db, cfg).catch((e) => { console.error('EEOS setup failed:', e); throw e; }));
ready().catch(() => {});

export default createApp(db, cfg, ready);
