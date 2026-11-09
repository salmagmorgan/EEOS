/* Workspace reads, audited mutations and undo. */
import type { InStatement, Transaction } from '@libsql/client';
import type { AuditEntry, User, WorkspaceData } from '../shared/types.js';
import {
  type DB, type Entity, type EntityType, all, engagementFromRow, getEntity, getMeta, inTransaction, one, putEntity,
  ruleFromRow, setMetaStatement, talentFromRow, trajectoryFromRow,
} from './db.js';

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// ---------- reads ----------
export async function readVersion(db: DB): Promise<{ version: number; updatedAt: string | null; updatedBy: string | null }> {
  const rows = await all<{ key: string; value: string }>(db, "SELECT key, value FROM meta WHERE key IN ('version','updatedAt','updatedBy')");
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { version: Number(m.version ?? 0), updatedAt: m.updatedAt ?? null, updatedBy: m.updatedBy ?? null };
}

export async function readWorkspace(db: DB): Promise<WorkspaceData> {
  // One round trip for everything (matters when the database is remote).
  const [meta, talents, engagements, clients, rules, trajectory] = await db.batch([
    "SELECT key, value FROM meta WHERE key IN ('version','updatedAt','updatedBy')",
    'SELECT * FROM talents ORDER BY rowid',
    'SELECT * FROM engagements ORDER BY rowid',
    'SELECT id,name,industry,country,owner FROM clients ORDER BY rowid',
    'SELECT * FROM capacity_rules',
    'SELECT * FROM trajectory ORDER BY id',
  ], 'read');
  const m = Object.fromEntries(meta.rows.map((r) => [r.key as string, r.value as string]));
  const rows = (rs: { rows: unknown[] }) => rs.rows as any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  return {
    version: Number(m.version ?? 0),
    updatedAt: m.updatedAt ?? null,
    updatedBy: m.updatedBy ?? null,
    talents: rows(talents).map(talentFromRow),
    engagements: rows(engagements).map(engagementFromRow),
    clients: rows(clients).map((r) => ({ id: r.id, name: r.name, industry: r.industry, country: r.country, owner: r.owner })),
    capacityRules: rows(rules).map(ruleFromRow),
    trajectory: rows(trajectory).map(trajectoryFromRow),
  };
}

async function bumpVersion(tx: Transaction, by: string): Promise<void> {
  const v = Number((await getMeta(tx, 'version')) ?? 0) + 1;
  const stmts: InStatement[] = [setMetaStatement('version', String(v)), setMetaStatement('updatedAt', new Date().toISOString()), setMetaStatement('updatedBy', by)];
  for (const s of stmts) await tx.execute(s);
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

/** Apply one change to one entity in a transaction and record before/after in the audit log. */
export async function mutate<T extends Entity>(db: DB, user: User, spec: MutationSpec<T>): Promise<T | null> {
  return inTransaction(db, async (tx) => {
    const before = (await getEntity(tx, spec.type, spec.id)) as T | null;
    const draft = before ? (structuredClone(before) as T) : null;
    const after = spec.apply(draft);
    const now = new Date().toISOString();
    if (after && 'updatedAt' in after) (after as { updatedAt: string }).updatedAt = now;
    await putEntity(tx, spec.type, spec.id, after);
    // Store the canonical (re-read) form so undo can compare it exactly later.
    const stored = after ? await getEntity(tx, spec.type, spec.id) : null;
    const named = (after ?? before) as { name?: string; title?: string; department?: string } | null;
    const entityName = named?.name ?? (named?.title ? `${named.title} · ${named.department}` : '');
    await tx.execute({
      sql: 'INSERT INTO audit_log (at,user_id,user_name,action,entity_type,entity_id,entity_name,details,before,after) VALUES (?,?,?,?,?,?,?,?,?,?)',
      args: [now, user.id, user.name, spec.action, spec.type, spec.id, entityName, spec.details?.(before, after) ?? '',
        before ? JSON.stringify(before) : null, stored ? JSON.stringify(stored) : null],
    });
    await bumpVersion(tx, user.name);
    return stored as T | null;
  });
}

/** Generic, safe undo: restores the "before" state of one audited change, but only if nothing
    has changed that entity since — otherwise the newer change must be undone first. */
export async function undo(db: DB, user: User, auditId: number): Promise<void> {
  await inTransaction(db, async (tx) => {
    const row = await one(tx, 'SELECT * FROM audit_log WHERE id=?', [auditId]);
    if (!row) throw new HttpError(404, 'That change no longer exists.');
    if (row.undone_at) throw new HttpError(409, 'That change was already undone.');
    if (row.entity_type === 'imported' || row.entity_type === 'undo' || (!row.before && !row.after)) throw new HttpError(409, 'That entry cannot be undone.');
    const current = await getEntity(tx, row.entity_type, row.entity_id);
    if ((current ? JSON.stringify(current) : null) !== row.after) throw new HttpError(409, `“${row.entity_name}” has changed since then. Undo the newer change first.`);
    await putEntity(tx, row.entity_type, row.entity_id, row.before ? JSON.parse(row.before) : null);
    const now = new Date().toISOString();
    await tx.execute({ sql: 'UPDATE audit_log SET undone_at=?, undone_by=? WHERE id=?', args: [now, user.name, auditId] });
    await tx.execute({
      sql: 'INSERT INTO audit_log (at,user_id,user_name,action,entity_type,entity_id,entity_name,details) VALUES (?,?,?,?,?,?,?,?)',
      args: [now, user.id, user.name, 'Undid: ' + row.action, 'undo', row.entity_id, row.entity_name, row.details],
    });
    await bumpVersion(tx, user.name);
  });
}

export async function listAudit(db: DB, opts: { q?: string; user?: string; limit?: number }): Promise<AuditEntry[]> {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (opts.user) { where.push('user_name = ?'); params.push(opts.user); }
  if (opts.q) {
    where.push(`(LOWER(action || ' ' || details || ' ' || entity_name || ' ' || user_name) LIKE ?)`);
    params.push('%' + opts.q.toLowerCase() + '%');
  }
  params.push(Math.min(1000, opts.limit ?? 300));
  const rows = await all(db, `SELECT id,at,user_id,user_name,action,entity_type,entity_id,entity_name,details,undone_at,undone_by,
    (before IS NOT NULL OR after IS NOT NULL) AS undoable FROM audit_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY id DESC LIMIT ?`, params);
  return rows.map((r) => ({
    id: Number(r.id), at: r.at, userId: r.user_id, userName: r.user_name, action: r.action, entityType: r.entity_type, entityId: r.entity_id,
    entityName: r.entity_name, details: r.details, undoable: !!r.undoable && !r.undone_at, undoneAt: r.undone_at, undoneBy: r.undone_by,
  }));
}

export async function auditPeople(db: DB): Promise<string[]> {
  return (await all<{ user_name: string }>(db, 'SELECT DISTINCT user_name FROM audit_log ORDER BY user_name')).map((r) => r.user_name);
}

/** The newest change by this user that can still be undone. */
export async function lastUndoable(db: DB, userId: string): Promise<number | null> {
  const r = await one(db, `SELECT id FROM audit_log WHERE user_id=? AND undone_at IS NULL AND entity_type NOT IN ('undo','imported')
    AND (before IS NOT NULL OR after IS NOT NULL) ORDER BY id DESC LIMIT 1`, [userId]);
  return r ? Number(r.id) : null;
}
