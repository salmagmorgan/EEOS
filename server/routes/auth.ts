import { Router } from 'express';
import { z } from 'zod';
import {
  SESSION_COOKIE, clearLoginFailures, createSession, createUser, destroySession, destroyUserSessions, findUserByEmail,
  getUserRow, hashPassword, listUsers, loginThrottled, recordLoginFailure, requireRole, userFromRow, validatePassword, verifyPassword,
} from '../auth.js';
import { type DB, run } from '../db.js';
import { HttpError } from '../store.js';
import { me, parse, route } from './util.js';

const roleSchema = z.enum(['admin', 'editor', 'viewer']);

export function authRoutes(db: DB, opts: { cookieSecure: boolean }): Router {
  const r = Router();

  r.post('/auth/login', route(async (req, res) => {
    const body = parse(z.object({ email: z.string().email(), password: z.string().min(1) }), req.body);
    const key = (req.ip ?? '') + '|' + body.email.toLowerCase();
    if (loginThrottled(key)) throw new HttpError(429, 'Too many attempts. Try again in 15 minutes.');
    const row = await findUserByEmail(db, body.email);
    if (!row || row.disabled || !verifyPassword(body.password, row.password_hash)) {
      recordLoginFailure(key);
      throw new HttpError(401, 'Email or password is incorrect.');
    }
    clearLoginFailures(key);
    const { token, expires } = await createSession(db, row.id);
    res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: opts.cookieSecure, expires, path: '/' });
    return { user: userFromRow(row) };
  }));

  r.post('/auth/logout', route(async (req, res) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) await destroySession(db, token);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  }));

  r.get('/auth/me', route((req) => ({ user: req.user ?? null })));

  r.post('/auth/password', requireRole('viewer'), route(async (req) => {
    const user = me(req);
    const body = parse(z.object({ current: z.string(), next: z.string() }), req.body);
    const row = (await getUserRow(db, user.id))!;
    if (!verifyPassword(body.current, row.password_hash)) throw new HttpError(400, 'Current password is incorrect.');
    const problem = validatePassword(body.next);
    if (problem) throw new HttpError(400, problem);
    await run(db, 'UPDATE users SET password_hash=? WHERE id=?', [hashPassword(body.next), user.id]);
    return { ok: true };
  }));

  r.patch('/auth/profile', requireRole('viewer'), route(async (req) => {
    const body = parse(z.object({ name: z.string().trim().min(1).max(80) }), req.body);
    await run(db, 'UPDATE users SET name=? WHERE id=?', [body.name, me(req).id]);
    return { ok: true };
  }));

  // ---- user management (admins) ----
  r.get('/users', requireRole('admin'), route(async () => ({ users: await listUsers(db) })));

  r.post('/users', requireRole('admin'), route(async (req) => {
    const body = parse(z.object({ name: z.string().trim().min(1), email: z.string().email(), role: roleSchema, password: z.string() }), req.body);
    const problem = validatePassword(body.password);
    if (problem) throw new HttpError(400, problem);
    if (await findUserByEmail(db, body.email)) throw new HttpError(409, 'A user with that email already exists.');
    return { user: await createUser(db, body) };
  }));

  r.patch('/users/:id', requireRole('admin'), route(async (req) => {
    const body = parse(z.object({ role: roleSchema.optional(), disabled: z.boolean().optional(), password: z.string().optional(), name: z.string().trim().min(1).optional() }), req.body);
    const id = req.params.id;
    if (!(await getUserRow(db, id))) throw new HttpError(404, 'User not found.');
    if (id === me(req).id && (body.disabled || (body.role && body.role !== 'admin'))) throw new HttpError(400, "You can't demote or disable your own account.");
    if (body.password) {
      const problem = validatePassword(body.password);
      if (problem) throw new HttpError(400, problem);
    }
    if (body.role) await run(db, 'UPDATE users SET role=? WHERE id=?', [body.role, id]);
    if (body.name) await run(db, 'UPDATE users SET name=? WHERE id=?', [body.name, id]);
    if (body.disabled !== undefined) {
      await run(db, 'UPDATE users SET disabled=? WHERE id=?', [body.disabled ? 1 : 0, id]);
      if (body.disabled) await destroyUserSessions(db, id);
    }
    if (body.password) {
      await run(db, 'UPDATE users SET password_hash=? WHERE id=?', [hashPassword(body.password), id]);
      await destroyUserSessions(db, id);
    }
    return { user: userFromRow((await getUserRow(db, id))!) };
  }));

  return r;
}
