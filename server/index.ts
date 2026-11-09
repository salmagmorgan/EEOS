/* Long-running server (local development, Docker, any Node host). Vercel uses api/index.ts instead. */
import fs from 'node:fs';
import { createApp } from './app.js';
import { bootstrap } from './bootstrap.js';
import { config } from './config.js';
import { openDb } from './db.js';

const cfg = config();
const db = openDb(cfg.databaseUrl, cfg.databaseAuthToken);
try {
  await bootstrap(db, cfg);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
createApp(db, cfg).listen(cfg.port, () => {
  const serving = cfg.staticDir && fs.existsSync(cfg.staticDir) && process.env.NODE_ENV === 'production';
  console.log(`EEOS listening on http://localhost:${cfg.port}${serving ? ' (serving the web app)' : ''}`);
  if (!cfg.anthropicApiKey) console.log('AI Copilot disabled — set ANTHROPIC_API_KEY to enable it.');
});
