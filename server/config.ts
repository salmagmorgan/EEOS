import fs from 'node:fs';
import path from 'node:path';

/** Minimal .env loader (KEY=VALUE lines) so no extra dependency is needed. Real env vars win. */
export function loadEnvFile(file = '.env'): void {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

export function config() {
  loadEnvFile();
  const env = process.env;
  return {
    port: Number(env.PORT ?? 8787),
    databasePath: env.DATABASE_PATH ?? './data/eeos.db',
    seedPath: env.SEED_PATH ?? './server/seed/demo-seed.json',
    demoSeedPath: path.resolve('./server/seed/demo-seed.json'),
    cookieSecure: env.COOKIE_SECURE === 'true',
    adminEmail: env.ADMIN_EMAIL,
    adminPassword: env.ADMIN_PASSWORD,
    adminName: env.ADMIN_NAME ?? 'EEOS Admin',
    anthropicApiKey: env.ANTHROPIC_API_KEY || undefined,
    copilotModel: env.COPILOT_MODEL || 'claude-opus-5-5',
    staticDir: path.resolve('./dist/client'),
  };
}
