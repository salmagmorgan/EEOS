import { Router } from 'express';
import { z } from 'zod';
import {
  SESSION_COOKIE, clearLoginFailures, createSession, createUser, destroySession, destroyUserSessions, findUserByEmail,
  hashPassword, loginThrottled, recordLoginFailure, requireRole, userFromRow, validatePassword, verifyPassword,
} from '../auth';
import type { DB } from '../db';
import { HttpError } from '../store';
import { me, parse, route } from './util';

const roleSchema = z.enum(['admin', 'editor', 'viewer']);

export function authRoutes(db: DB, opts: { cookieSecure: boolean }): Router {
  const r = Router();

  r.post('/auth/login', route((req, res) => {
    const body = parse(z.object({ email: z.string().email(), password: z.string().min(1) }), req.body);
    const key = (req.ip ?? '') + '|' + body.email.toLowerCase();
    if (loginThrottled(key)) throw new HttpError(429, 'Too many attempts. Try again in 15 minutes.');
    const row = findUserByEmail(db, body.email);
    if (!row || row.disabled || !verifyPassword(body.password, row.password_hash)) {
      recordLoginFailure(key);
      throw new HttpError(401, 'Email or password is incorrect.');
    }
    clearLoginFailures(key);
    const { token, expires } = createSession(db, row.id);
    res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: opts.cookieSecure, expires, path: '/' });
    return { user: userFromRow(row) };
  }));

  r.post('/auth/logout', route((req, res) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) destroySession(db, token);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  }));

  r.get('/auth/me', route((req) => ({ user: req.user ?? null })));

  r.post('/auth/password', requireRole('viewer'), route((req) => {
    const user = me(req);
    const body = parse(z.object({ current: z.string(), next: z.string() }), req.body);
    const row = findUserByEmail(db, user.email)!;
    if (!verifyPassword(body.current, row.password_hash)) throw new HttpError(400, 'Current password is incorrect.');
    const problem = validatePassword(body.next);
    if (problem) throw new HttpError(400, problem);
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(body.next), user.id);
    return { ok: true };
  }));

  r.patch('/auth/profile', requireRole('viewer'), route((req) => {
    const user = me(req);
    const body = parse(z.object({ name: z.string().trim().min(1).max(80) }), req.body);
    db.prepare('UPDATE users SET name=? WHERE id=?').run(body.name, user.id);
    return { ok: true };
  }));

  // ---- user management (admins) ----
  r.get('/users', requireRole('admin'), route(() => ({
    users: (db.prepare('SELECT * FROM users ORDER BY created_at').all() as Parameters<typeof userFromRow>[0][]).map(userFromRow),
  })));

  r.post('/users', requireRole('admin'), route((req) => {
    const body = parse(z.object({ name: z.string().trim().min(1), email: z.string().email(), role: roleSchema, password: z.string() }), req.body);
    const problem = validatePassword(body.password);
    if (problem) throw new HttpError(400, problem);
    if (findUserByEmail(db, body.email)) throw new HttpError(409, 'A user with that email already exists.');
    return { user: createUser(db, body) };
  }));

  r.patch('/users/:id', requireRole('admin'), route((req) => {
    const body = parse(z.object({ role: roleSchema.optional(), disabled: z.boolean().optional(), password: z.string().optional(), name: z.string().trim().min(1).optional() }), req.body);
    const id = req.params.id;
    const target = db.prepare('SELECT * FROM users WHERE id=?').get(id) as Parameters<typeof userFromRow>[0] | undefined;
    if (!target) throw new HttpError(404, 'User not found.');
    if (id === me(req).id && (body.disabled || (body.role && body.role !== 'admin'))) throw new HttpError(400, "You can't demote or disable your own account.");
    if (body.role) db.prepare('UPDATE users SET role=? WHERE id=?').run(body.role, id);
    if (body.name) db.prepare('UPDATE users SET name=? WHERE id=?').run(body.name, id);
    if (body.disabled !== undefined) {
      db.prepare('UPDATE users SET disabled=? WHERE id=?').run(body.disabled ? 1 : 0, id);
      if (body.disabled) destroyUserSessions(db, id);
    }
    if (body.password) {
      const problem = validatePassword(body.password);
      if (problem) throw new HttpError(400, problem);
      db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(body.password), id);
      destroyUserSessions(db, id);
    }
    return { user: userFromRow(db.prepare('SELECT * FROM users WHERE id=?').get(id) as Parameters<typeof userFromRow>[0]) };
  }));

  return r;
}
