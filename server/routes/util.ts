import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import type { User } from '../../shared/types';
import { HttpError } from '../store';

/** Wrap a handler so thrown HttpErrors / validation errors become clean JSON responses. */
export function route(fn: (req: Request, res: Response) => unknown): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const out = await fn(req, res);
      if (!res.headersSent && out !== undefined) res.json(out);
    } catch (err) {
      if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
      if (err instanceof ZodError) {
        const first = err.issues[0];
        return res.status(400).json({ error: `${first.path.join('.') || 'Input'}: ${first.message}` });
      }
      next(err);
    }
  };
}

export function parse<S extends ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  return schema.parse(value);
}

export function me(req: Request): User {
  if (!req.user) throw new HttpError(401, 'Please sign in.');
  return req.user;
}
