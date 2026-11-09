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

export type Config = ReturnType<typeof config>;

export function config() {
  loadEnvFile();
  const env = process.env;
  const onVercel = !!env.VERCEL;
  return {
    onVercel,
    port: Number(env.PORT ?? 8787),
    /** libsql URL. Turso in production (libsql://…), a local file in development. */
    databaseUrl: env.DATABASE_URL || env.TURSO_DATABASE_URL || './data/eeos.db',
    databaseAuthToken: env.DATABASE_AUTH_TOKEN || env.TURSO_AUTH_TOKEN || undefined,
    // process.cwd() is the project root locally and on Vercel (/var/task).
    seedPath: path.resolve(process.cwd(), env.SEED_PATH ?? 'server/seed/demo-seed.json'),
    demoSeedPath: path.resolve(process.cwd(), 'server/seed/demo-seed.json'),
    cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : onVercel,
    adminEmail: env.ADMIN_EMAIL,
    adminPassword: env.ADMIN_PASSWORD,
    adminName: env.ADMIN_NAME ?? 'EEOS Admin',
    anthropicApiKey: env.ANTHROPIC_API_KEY || undefined,
    copilotModel: env.COPILOT_MODEL || 'claude-opus-5-5',
    staticDir: onVercel ? undefined : path.resolve(process.cwd(), 'dist/client'),
  };
}
