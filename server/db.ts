import { createClient, type Client as LibsqlClient, type InArgs, type InStatement, type Transaction } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';
import type { CapacityRule, Client, Engagement, SeedFile, Talent, TrajectoryRow } from '../shared/types.js';

/** The database: a local SQLite file in development, Turso (hosted libSQL) in production. */
export type DB = LibsqlClient;
/** Anything that can run a statement — the client itself or an open transaction. */
export type Exec = Pick<LibsqlClient | Transaction, 'execute'>;

const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin','editor','viewer')),
    disabled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE talents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    initials TEXT NOT NULL,
    title TEXT NOT NULL,
    department TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active','removed','alumni')),
    util_override TEXT,
    flag TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE clients (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    industry TEXT NOT NULL DEFAULT '',
    country TEXT NOT NULL DEFAULT '',
    owner TEXT NOT NULL DEFAULT 'Unassigned'
  );
  CREATE TABLE engagements (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    client TEXT NOT NULL,
    country TEXT NOT NULL,
    sector TEXT NOT NULL,
    scope TEXT NOT NULL,
    sub_scope TEXT,
    stage TEXT NOT NULL,
    lead_id TEXT NOT NULL,
    team_ids TEXT NOT NULL,
    supervisor_id TEXT,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    workload_tier TEXT NOT NULL,
    custom_cps TEXT,
    price REAL,
    cost REAL,
    status TEXT NOT NULL CHECK (status IN ('active','paused','closed','deleted')),
    historical INTEGER NOT NULL DEFAULT 0,
    allocation_overrides TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS engagements_status ON engagements(status);
  CREATE TABLE capacity_rules (
    title TEXT NOT NULL,
    department TEXT NOT NULL,
    project INTEGER NOT NULL,
    leadership INTEGER NOT NULL,
    placeholder INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (title, department)
  );
  CREATE TABLE trajectory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    year INTEGER NOT NULL,
    month TEXT NOT NULL,
    engagement TEXT NOT NULL,
    sector TEXT NOT NULL,
    scope TEXT NOT NULL,
    status TEXT NOT NULL,
    talent TEXT NOT NULL,
    talent_id TEXT,
    title TEXT NOT NULL,
    role TEXT NOT NULL,
    client TEXT NOT NULL
  );
  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    user_id TEXT,
    user_name TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    entity_name TEXT NOT NULL DEFAULT '',
    details TEXT NOT NULL DEFAULT '',
    before TEXT,
    after TEXT,
    undone_at TEXT,
    undone_by TEXT
  );
  CREATE INDEX IF NOT EXISTS audit_entity ON audit_log(entity_type, entity_id);
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `,
];

export function openDb(url: string, authToken?: string): DB {
  if (url !== ':memory:' && !/^[a-z]+:/.test(url)) {
    // A bare path: make sure its folder exists and turn it into a file: URL.
    fs.mkdirSync(path.dirname(path.resolve(url)), { recursive: true });
    url = 'file:' + url;
  }
  return createClient({ url, authToken: authToken || undefined });
}

/** Apply any pending schema migrations. Safe to run on every cold start. */
export async function migrate(db: DB): Promise<void> {
  await db.execute('CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  const done = new Set((await db.execute('SELECT version FROM _migrations')).rows.map((r) => Number(r.version)));
  for (let v = 0; v < MIGRATIONS.length; v++) {
    if (done.has(v + 1)) continue;
    const stmts = MIGRATIONS[v].split(';').map((x) => x.trim()).filter(Boolean);
    await db.batch([...stmts, { sql: 'INSERT OR IGNORE INTO _migrations (version, applied_at) VALUES (?, ?)', args: [v + 1, new Date().toISOString()] }], 'write');
  }
}

/** Run `fn` inside a write transaction. */
export async function inTransaction<T>(db: DB, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  const tx = await db.transaction('write');
  try {
    const out = await fn(tx);
    await tx.commit();
    return out;
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  } finally {
    tx.close();
  }
}

export async function one<T = Row>(ex: Exec, sql: string, args: InArgs = []): Promise<T | undefined> {
  return (await ex.execute({ sql, args })).rows[0] as T | undefined;
}
export async function all<T = Row>(ex: Exec, sql: string, args: InArgs = []): Promise<T[]> {
  return (await ex.execute({ sql, args })).rows as unknown as T[];
}
export async function run(ex: Exec, sql: string, args: InArgs = []): Promise<void> {
  await ex.execute({ sql, args });
}

// ---------- row mapping ----------
const json = <T>(s: string | null): T | null => (s ? (JSON.parse(s) as T) : null);

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const talentFromRow = (r: Row): Talent => ({
  id: r.id, name: r.name, initials: r.initials, title: r.title, department: r.department, status: r.status,
  utilOverride: json(r.util_override), flag: json(r.flag), createdAt: r.created_at, updatedAt: r.updated_at,
});
export const engagementFromRow = (r: Row): Engagement => ({
  id: r.id, name: r.name, client: r.client, country: r.country, sector: r.sector, scope: r.scope, subScope: r.sub_scope,
  stage: r.stage, leadId: r.lead_id, teamIds: JSON.parse(r.team_ids), supervisorId: r.supervisor_id, start: r.start_date,
  end: r.end_date, notes: r.notes, workloadTier: r.workload_tier, customCps: json(r.custom_cps), price: r.price, cost: r.cost,
  status: r.status, historical: !!r.historical, allocationOverrides: JSON.parse(r.allocation_overrides),
  createdAt: r.created_at, updatedAt: r.updated_at,
});
export const ruleFromRow = (r: Row): CapacityRule => ({ title: r.title, department: r.department, project: r.project, leadership: r.leadership, placeholder: !!r.placeholder });
export const trajectoryFromRow = (r: Row): TrajectoryRow => ({
  id: r.id, year: r.year, month: r.month, engagement: r.engagement, sector: r.sector, scope: r.scope, status: r.status,
  talent: r.talent, talentId: r.talent_id, title: r.title, role: r.role, client: r.client,
});

/** Entity tables that support generic write/delete (used by mutations and undo). */
export type EntityType = 'talent' | 'engagement' | 'client' | 'capacityRule';
export type Entity = Talent | Engagement | Client | CapacityRule;

export async function getEntity(ex: Exec, type: EntityType, id: string): Promise<Entity | null> {
  switch (type) {
    case 'talent': { const r = await one(ex, 'SELECT * FROM talents WHERE id=?', [id]); return r ? talentFromRow(r) : null; }
    case 'engagement': { const r = await one(ex, 'SELECT * FROM engagements WHERE id=?', [id]); return r ? engagementFromRow(r) : null; }
    case 'client': {
      const r = await one(ex, 'SELECT id,name,industry,country,owner FROM clients WHERE id=?', [id]);
      return r ? { id: r.id, name: r.name, industry: r.industry, country: r.country, owner: r.owner } : null;
    }
    case 'capacityRule': {
      const [title, department] = id.split('__');
      const r = await one(ex, 'SELECT * FROM capacity_rules WHERE title=? AND department=?', [title, department]);
      return r ? ruleFromRow(r) : null;
    }
  }
}

/** Statement that inserts-or-replaces one entity, or deletes it when `value` is null. */
export function putStatement(type: EntityType, id: string, value: Entity | null): InStatement {
  if (value === null) {
    if (type === 'capacityRule') {
      const [title, department] = id.split('__');
      return { sql: 'DELETE FROM capacity_rules WHERE title=? AND department=?', args: [title, department] };
    }
    const table = { talent: 'talents', engagement: 'engagements', client: 'clients' }[type];
    return { sql: `DELETE FROM ${table} WHERE id=?`, args: [id] };
  }
  switch (type) {
    case 'talent': {
      const t = value as Talent;
      return { sql: `INSERT OR REPLACE INTO talents (id,name,initials,title,department,status,util_override,flag,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        args: [t.id, t.name, t.initials, t.title, t.department, t.status, t.utilOverride ? JSON.stringify(t.utilOverride) : null, t.flag ? JSON.stringify(t.flag) : null, t.createdAt, t.updatedAt] };
    }
    case 'engagement': {
      const e = value as Engagement;
      return { sql: `INSERT OR REPLACE INTO engagements (id,name,client,country,sector,scope,sub_scope,stage,lead_id,team_ids,supervisor_id,
        start_date,end_date,notes,workload_tier,custom_cps,price,cost,status,historical,allocation_overrides,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        args: [e.id, e.name, e.client, e.country, e.sector, e.scope, e.subScope, e.stage, e.leadId, JSON.stringify(e.teamIds), e.supervisorId,
          e.start, e.end, e.notes, e.workloadTier, e.customCps ? JSON.stringify(e.customCps) : null, e.price, e.cost, e.status,
          e.historical ? 1 : 0, JSON.stringify(e.allocationOverrides ?? {}), e.createdAt, e.updatedAt] };
    }
    case 'client': {
      const c = value as Client;
      return { sql: 'INSERT OR REPLACE INTO clients (id,name,industry,country,owner) VALUES (?,?,?,?,?)', args: [c.id, c.name, c.industry, c.country, c.owner] };
    }
    case 'capacityRule': {
      const r = value as CapacityRule;
      return { sql: 'INSERT OR REPLACE INTO capacity_rules (title,department,project,leadership,placeholder) VALUES (?,?,?,?,?)', args: [r.title, r.department, r.project, r.leadership, r.placeholder ? 1 : 0] };
    }
  }
}
export async function putEntity(ex: Exec, type: EntityType, id: string, value: Entity | null): Promise<void> {
  await ex.execute(putStatement(type, id, value));
}

export async function getMeta(ex: Exec, key: string): Promise<string | null> {
  return (await one<{ value: string }>(ex, 'SELECT value FROM meta WHERE key=?', [key]))?.value ?? null;
}
export function setMetaStatement(key: string, value: string): InStatement {
  return { sql: 'INSERT OR REPLACE INTO meta (key,value) VALUES (?,?)', args: [key, value] };
}
export async function setMeta(ex: Exec, key: string, value: string): Promise<void> {
  await ex.execute(setMetaStatement(key, value));
}

export async function isEmpty(db: DB): Promise<boolean> {
  return Number((await one(db, 'SELECT COUNT(*) AS n FROM talents'))!.n) === 0;
}

/** Replace all business data with a seed file, atomically. Users and sessions are kept. */
export async function loadSeed(db: DB, seed: SeedFile): Promise<void> {
  const version = Number((await getMeta(db, 'version')) ?? 0) + 1;
  const stmts: InStatement[] = ['talents', 'engagements', 'clients', 'capacity_rules', 'trajectory', 'audit_log'].map((t) => `DELETE FROM ${t}`);
  seed.talents.forEach((t) => stmts.push(putStatement('talent', t.id, t)));
  seed.engagements.forEach((e) => stmts.push(putStatement('engagement', e.id, e)));
  seed.clients.forEach((c) => stmts.push(putStatement('client', c.id, c)));
  seed.capacityRules.forEach((r) => stmts.push(putStatement('capacityRule', r.title + '__' + r.department, r)));
  seed.trajectory.forEach((r) => stmts.push({
    sql: 'INSERT INTO trajectory (year,month,engagement,sector,scope,status,talent,talent_id,title,role,client) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    args: [r.year, r.month, r.engagement, r.sector, r.scope, r.status, r.talent, r.talentId, r.title, r.role, r.client],
  }));
  (seed.audit ?? []).forEach((a) => stmts.push({
    sql: 'INSERT INTO audit_log (at,user_id,user_name,action,entity_type,entity_id,entity_name,details) VALUES (?,?,?,?,?,?,?,?)',
    args: [a.at, null, a.userName, a.action, 'imported', '', a.entityName, a.details],
  }));
  stmts.push(setMetaStatement('version', String(version)), setMetaStatement('updatedAt', new Date().toISOString()), setMetaStatement('updatedBy', 'Seed: ' + seed.description));
  await db.batch(stmts, 'write');
}
