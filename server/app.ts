import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { authenticate, csrfGuard } from './auth.js';
import { SetupError } from './bootstrap.js';
import type { DB } from './db.js';
import { type Mailer, createMailer } from './mailer.js';
import { authRoutes } from './routes/auth.js';
import { notificationRoutes } from './routes/notifications.js';
import { copilotRoutes } from './routes/copilot.js';
import { entityRoutes } from './routes/entities.js';
import { workspaceRoutes } from './routes/workspace.js';

export interface AppConfig {
  cookieSecure: boolean;
  demoSeedPath: string;
  anthropicApiKey?: string;
  copilotModel: string;
  /** Directory with the built web app; served when present. */
  staticDir?: string;
  onVercel?: boolean;
  /** Outgoing email; defaults to Microsoft 365 (MS_*) or SMTP (SMTP_*) from environment variables. */
  mailer?: Mailer;
}

/** Database setup gate: memoizes success, and on failure lets the next request try again
    (so a one-off network blip at a cold start doesn't leave the server stuck). */
export function readyGate(run: () => Promise<void>): () => Promise<void> {
  let pending: Promise<void> | null = null;
  return () => {
    if (!pending) pending = run().catch((e) => { pending = null; throw e; });
    return pending;
  };
}

export function createApp(db: DB, config: AppConfig, ready: () => Promise<void> = () => Promise.resolve()) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });
  app.use(express.json({ limit: '25mb' }));
  app.use(cookieParser());
  app.get('/api/health', async (_req, res) => {
    try { await ready(); res.json({ ok: true }); } catch (e) { res.status(503).json({ ok: false, error: (e as Error).message }); }
  });
  // Wait for database setup (migrations, seed, first admin) before handling anything.
  app.use('/api', async (_req, res, next) => {
    try {
      await ready();
      next();
    } catch (e) {
      res.status(503).json({ error: e instanceof SetupError ? e.message : 'EEOS can’t reach its database right now — please try again in a few seconds.' });
    }
  });
  app.use('/api', authenticate(db), csrfGuard);
  app.use('/api', authRoutes(db, { cookieSecure: config.cookieSecure }));
  app.use('/api', workspaceRoutes(db, { demoSeedPath: config.demoSeedPath }));
  const mailer = config.mailer ?? createMailer();
  app.use('/api', entityRoutes(db, mailer));
  app.use('/api', notificationRoutes(db, mailer));
  app.use('/api', copilotRoutes(db, { apiKey: config.anthropicApiKey, model: config.copilotModel }));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

  if (config.staticDir && fs.existsSync(config.staticDir)) {
    app.use(express.static(config.staticDir, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile(path.join(config.staticDir!, 'index.html')));
  }

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => { // eslint-disable-line @typescript-eslint/no-unused-vars
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  });
  return app;
}
