/* Workspace reads, audited mutations, undo, and change notifications. */
import type { Response } from 'express';
import type { AuditEntry, User, WorkspaceData } from '../shared/types';
import {
  type DB, type Entity, type EntityType, engagementFromRow, getEntity, getMeta, putEntity, ruleFromRow, setMeta,
  talentFromRow, trajectoryFromRow,
} from './db';

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// ---------- live change feed (Server-Sent Events) ----------
const listeners = new Set<Response>();
export function subscribe(res: Response): void {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 3000\n\n');
  listeners.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
  res.on('close', () => {
    clearInterval(ping);
    listeners.delete(res);
  });
}
export function broadcast(payload: object): void {
  const msg = `data: ${JSON.stringify(payload)}\n\n`;
  listeners.forEach((res) => res.write(msg));
}

// ---------- reads ----------
export function readWorkspace(db: DB): WorkspaceData {
  return {
    version: Number(getMeta(db, 'version') ?? 0),
    updatedAt: getMeta(db, 'updatedAt'),
    updatedBy: getMeta(db, 'updatedBy'),
    talents: (db.prepare('SELECT * FROM talents ORDER BY rowid').all() as any[]).map(talentFromRow), // eslint-disable-line @typescript-eslint/no-explicit-any
    engagements: (db.prepare('SELECT * FROM engagements ORDER BY rowid').all() as any[]).map(engagementFromRow), // eslint-disable-line @typescript-eslint/no-explicit-any
    clients: db.prepare('SELECT * FROM clients ORDER BY rowid').all() as WorkspaceData['clients'],
    capacityRules: (db.prepare('SELECT * FROM capacity_rules').all() as any[]).map(ruleFromRow), // eslint-disable-line @typescript-eslint/no-explicit-any
    trajectory: (db.prepare('SELECT * FROM trajectory ORDER BY id').all() as any[]).map(trajectoryFromRow), // eslint-disable-line @typescript-eslint/no-explicit-any
  };
}

function bumpVersion(db: DB, by: string): number {
  const v = Number(getMeta(db, 'version') ?? 0) + 1;
  setMeta(db, 'version', String(v));
  setMeta(db, 'updatedAt', new Date().toISOString());
  setMeta(db, 'updatedBy', by);
  return v;
}

// ---------- audited mutations ----------
export interface MutationSpec<T extends Entity> {
  type: EntityType;
  id: string;
  action: string;
  /** Receives a copy of the current entity (or null) and returns the new state, or null to delete. */
  apply: (current: T | null) => T | null;
  details?: (before: T | null, after: T | null) => string;
}

/** Apply one change to one entity in a transaction, record before/after in the audit log, and notify clients. */
export function mutate<T extends Entity>(db: DB, user: User, spec: MutationSpec<T>): T | null {
  let version = 0;
  const result = db.transaction(() => {
    const before = getEntity(db, spec.type, spec.id) as T | null;
    const draft = before ? (structuredClone(before) as T) : null;
    const after = spec.apply(draft);
    const now = new Date().toISOString();
    if (after && 'updatedAt' in after) (after as { updatedAt: string }).updatedAt = now;
    putEntity(db, spec.type, spec.id, after);
    // Store the canonical (re-read) form so undo can compare it byte-for-byte later.
    const stored = after ? getEntity(db, spec.type, spec.id) : null;
    const name = (after ?? before) as { name?: string; title?: string; department?: string } | null;
    const entityName = name?.name ?? (name?.title ? `${name.title} · ${name.department}` : '');
    db.prepare(`INSERT INTO audit_log (at,user_id,user_name,action,entity_type,entity_id,entity_name,details,before,after) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(now, user.id, user.name, spec.action, spec.type, spec.id, entityName, spec.details?.(before, after) ?? '',
        before ? JSON.stringify(before) : null, stored ? JSON.stringify(stored) : null);
    version = bumpVersion(db, user.name);
    return stored as T | null;
  })();
  broadcast({ type: 'changed', version, by: user.name });
  return result;
}

/** Generic, safe undo: restores the "before" state of one audited change, but only if nothing
    has changed that entity since — otherwise the newer change must be undone first. */
export function undo(db: DB, user: User, auditId: number): void {
  let version = 0;
  db.transaction(() => {
    const row = db.prepare('SELECT * FROM audit_log WHERE id=?').get(auditId) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!row) throw new HttpError(404, 'That change no longer exists.');
    if (row.undone_at) throw new HttpError(409, 'That change was already undone.');
    if (row.entity_type === 'imported' || row.entity_type === 'undo' || (!row.before && !row.after)) throw new HttpError(409, 'That entry cannot be undone.');
    const current = getEntity(db, row.entity_type, row.entity_id);
    const currentJson = current ? JSON.stringify(current) : null;
    if (currentJson !== row.after) throw new HttpError(409, `“${row.entity_name}” has changed since then. Undo the newer change first.`);
    putEntity(db, row.entity_type, row.entity_id, row.before ? JSON.parse(row.before) : null);
    const now = new Date().toISOString();
    db.prepare('UPDATE audit_log SET undone_at=?, undone_by=? WHERE id=?').run(now, user.name, auditId);
    db.prepare(`INSERT INTO audit_log (at,user_id,user_name,action,entity_type,entity_id,entity_name,details) VALUES (?,?,?,?,?,?,?,?)`)
      .run(now, user.id, user.name, 'Undid: ' + row.action, 'undo', row.entity_id, row.entity_name, row.details);
    version = bumpVersion(db, user.name);
  })();
  broadcast({ type: 'changed', version, by: user.name });
}

export function listAudit(db: DB, opts: { q?: string; user?: string; limit?: number }): AuditEntry[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.user) { where.push('user_name = ?'); params.push(opts.user); }
  if (opts.q) {
    where.push(`(LOWER(action || ' ' || details || ' ' || entity_name || ' ' || user_name) LIKE ?)`);
    params.push('%' + opts.q.toLowerCase() + '%');
  }
  const sql = `SELECT id,at,user_id,user_name,action,entity_type,entity_id,entity_name,details,undone_at,undone_by,
    (before IS NOT NULL OR after IS NOT NULL) AS undoable FROM audit_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY id DESC LIMIT ?`;
  params.push(Math.min(1000, opts.limit ?? 300));
  return (db.prepare(sql).all(...params) as any[]).map((r) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
    id: r.id, at: r.at, userId: r.user_id, userName: r.user_name, action: r.action, entityType: r.entity_type, entityId: r.entity_id,
    entityName: r.entity_name, details: r.details, undoable: !!r.undoable && !r.undone_at, undoneAt: r.undone_at, undoneBy: r.undone_by,
  }));
}

export function auditPeople(db: DB): string[] {
  return (db.prepare('SELECT DISTINCT user_name FROM audit_log ORDER BY user_name').all() as { user_name: string }[]).map((r) => r.user_name);
}

/** The newest change by this user that can still be undone. */
export function lastUndoable(db: DB, userId: string): number | null {
  const r = db.prepare(`SELECT id FROM audit_log WHERE user_id=? AND undone_at IS NULL AND entity_type NOT IN ('undo','imported')
    AND (before IS NOT NULL OR after IS NOT NULL) ORDER BY id DESC LIMIT 1`).get(userId) as { id: number } | undefined;
  return r?.id ?? null;
}
