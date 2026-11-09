import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Role, User } from '../shared/types';
import type { DB } from './db';

export const SESSION_COOKIE = 'eeos_session';
const SESSION_DAYS = 14;
const ROLE_RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2 };

declare module 'express-serve-static-core' {
  interface Request {
    user?: User;
  }
}

// ---------- passwords (scrypt, no native dependency) ----------
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}
export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(actual, expected);
}
export function validatePassword(pw: string): string | null {
  return pw.length >= 10 ? null : 'Passwords need at least 10 characters.';
}

// ---------- users ----------
type UserRow = { id: string; name: string; email: string; role: Role; disabled: number; created_at: string; password_hash: string };
export const userFromRow = (r: UserRow): User => ({ id: r.id, name: r.name, email: r.email, role: r.role, disabled: !!r.disabled, createdAt: r.created_at });

export function createUser(db: DB, u: { name: string; email: string; role: Role; password: string }): User {
  const id = 'u_' + crypto.randomBytes(8).toString('hex');
  db.prepare('INSERT INTO users (id,name,email,password_hash,role,disabled,created_at) VALUES (?,?,?,?,?,0,?)')
    .run(id, u.name.trim(), u.email.trim().toLowerCase(), hashPassword(u.password), u.role, new Date().toISOString());
  return userFromRow(db.prepare('SELECT * FROM users WHERE id=?').get(id) as UserRow);
}
export function findUserByEmail(db: DB, email: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE email=?').get(email.trim().toLowerCase()) as UserRow | undefined;
}
export function userCount(db: DB): number {
  return (db.prepare('SELECT COUNT(*) n FROM users').get() as { n: number }).n;
}

// ---------- sessions ----------
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export function createSession(db: DB, userId: string): { token: string; expires: Date } {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  db.prepare('INSERT INTO sessions (token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)').run(sha(token), userId, new Date().toISOString(), expires.toISOString());
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString());
  return { token, expires };
}
export function destroySession(db: DB, token: string): void {
  db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha(token));
}
export function destroyUserSessions(db: DB, userId: string): void {
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);
}

export function authenticate(db: DB) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) {
      const row = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash=? AND s.expires_at > ?`)
        .get(sha(token), new Date().toISOString()) as UserRow | undefined;
      if (row && !row.disabled) req.user = userFromRow(row);
    }
    next();
  };
}

export function requireRole(min: Role) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
    if (ROLE_RANK[req.user.role] < ROLE_RANK[min])
      return res.status(403).json({ error: min === 'admin' ? 'Only admins can do this.' : 'View-only access — ask an editor to make this change.' });
    next();
  };
}

/** Cross-site request protection: every state-changing request must carry the X-EEOS header,
    which a browser will not send cross-origin without a CORS preflight we never grant. */
export function csrfGuard(req: Request, res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-eeos') !== '1') return res.status(403).json({ error: 'Missing request header.' });
  next();
}

/** Simple in-memory login throttle: 10 failed attempts per IP+email per 15 minutes. */
const attempts = new Map<string, { n: number; reset: number }>();
export function loginThrottled(key: string): boolean {
  const a = attempts.get(key);
  return !!a && a.reset > Date.now() && a.n >= 10;
}
export function recordLoginFailure(key: string): void {
  const a = attempts.get(key);
  if (!a || a.reset < Date.now()) attempts.set(key, { n: 1, reset: Date.now() + 15 * 60_000 });
  else a.n++;
}
export function clearLoginFailures(key: string): void {
  attempts.delete(key);
}
