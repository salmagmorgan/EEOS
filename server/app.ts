import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { authenticate, csrfGuard } from './auth';
import type { DB } from './db';
import { authRoutes } from './routes/auth';
import { copilotRoutes } from './routes/copilot';
import { entityRoutes } from './routes/entities';
import { workspaceRoutes } from './routes/workspace';

export interface AppConfig {
  cookieSecure: boolean;
  demoSeedPath: string;
  anthropicApiKey?: string;
  copilotModel: string;
  /** Directory with the built web app; served when present. */
  staticDir?: string;
}

export function createApp(db: DB, config: AppConfig) {
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
  app.use('/api', authenticate(db), csrfGuard);
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api', authRoutes(db, { cookieSecure: config.cookieSecure }));
  app.use('/api', workspaceRoutes(db, { demoSeedPath: config.demoSeedPath }));
  app.use('/api', entityRoutes(db));
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
