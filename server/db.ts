import { createClient, type InArgs } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import type { CapacityRule, Client, Engagement, SeedFile, Talent, TrajectoryRow } from '../shared/types.js';

/* EEOS runs on either of two databases, behind one small interface:
   - SQLite: a local file in development, or Turso (hosted SQLite) in production
   - Postgres: e.g. Neon, which Vercel's Storage tab offers
   SQL is written once in a portable subset (`?` placeholders, ON CONFLICT upserts). */

export type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export interface Stmt { sql: string; args?: unknown[] }
export type StmtLike = Stmt | string;
/** Anything that can run a statement — the database itself or an open transaction. */
export interface Exec { execute(stmt: StmtLike): Promise<{ rows: Row[] }> }
export interface DB extends Exec {
  dialect: 'sqlite' | 'postgres';
  /** Run several statements atomically, returning each result. */
  batch(stmts: StmtLike[], mode?: 'read' | 'write'): Promise<{ rows: Row[] }[]>;
  transaction<T>(fn: (tx: Exec) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
const norm = (s: StmtLike): Stmt => (typeof s === 'string' ? { sql: s, args: [] } : s);

function sqliteDb(url: string, authToken?: string): DB {
  const client = createClient({ url, authToken: authToken || undefined });
  const exec = (target: { execute: typeof client.execute }) => async (s: StmtLike) => {
    const st = norm(s);
    return { rows: (await target.execute({ sql: st.sql, args: (st.args ?? []) as InArgs })).rows as Row[] };
  };
  return {
    dialect: 'sqlite',
    execute: exec(client),
    async batch(stmts, mode = 'write') {
      const res = await client.batch(stmts.map(norm).map((st) => ({ sql: st.sql, args: (st.args ?? []) as InArgs })), mode);
      return res.map((r) => ({ rows: r.rows as Row[] }));
    },
    async transaction(fn) {
      const tx = await client.transaction('write');
      try {
        const out = await fn({ execute: exec(tx) });
        await tx.commit();
        return out;
      } catch (e) {
        await tx.rollback().catch(() => {});
        throw e;
      } finally {
        tx.close();
      }
    },
    async close() { client.close(); },
  };
}

/** Minimal Postgres connection surface, satisfied by `pg` (production) and PGlite (tests). */
export interface PgLike {
  query(text: string, params: unknown[]): Promise<{ rows: Row[] }>;
  inTransaction<T>(fn: (q: (text: string, params: unknown[]) => Promise<{ rows: Row[] }>) => Promise<T>): Promise<T>;
  end(): Promise<void>;
}
/** `?` placeholders → `$1, $2…` (EEOS SQL never contains a literal `?`). */
const toPg = (sql: string) => { let i = 0; return sql.replace(/\?/g, () => '$' + ++i); };

export function postgresDb(conn: PgLike): DB {
  const exec = (q: PgLike['query']) => async (s: StmtLike) => {
    const st = norm(s);
    return { rows: (await q(toPg(st.sql), st.args ?? [])).rows };
  };
  const db: DB = {
    dialect: 'postgres',
    execute: exec((t, p) => conn.query(t, p)),
    batch: (stmts) => conn.inTransaction(async (q) => {
      const out = [];
      for (const s of stmts) out.push(await exec(q)(s));
      return out;
    }),
    transaction: (fn) => conn.inTransaction((q) => fn({ execute: exec(q) })),
    close: () => conn.end(),
  };
  return db;
}

function pgPool(url: string): PgLike {
  const pool = new pg.Pool({ connectionString: url, max: 5, idleTimeoutMillis: 10_000 });
  return {
    query: (t, p) => pool.query(t, p as unknown[]),
    async inTransaction(fn) {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const out = await fn((t, p) => c.query(t, p as unknown[]));
        await c.query('COMMIT');
        return out;
      } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    },
    end: () => pool.end(),
  };
}

/** Schema migrations, in order. A plain string runs on both databases (adapted for Postgres);
    an object gives each database its own statements. */
const MIGRATIONS: (string | { sqlite: string; postgres: string })[] = [
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
    before_json TEXT,
    after_json TEXT,
    undone_at TEXT,
    undone_by TEXT
  );
  CREATE INDEX IF NOT EXISTS audit_entity ON audit_log(entity_type, entity_id);
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `,
  // 2: end dates are optional (never estimated); clear the estimates the prototype importer filled in.
  {
    sqlite: `
  CREATE TABLE engagements_v2 (
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
    end_date TEXT,
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
  );;
  INSERT INTO engagements_v2 SELECT * FROM engagements;
  DROP TABLE engagements;
  ALTER TABLE engagements_v2 RENAME TO engagements;
  CREATE INDEX IF NOT EXISTS engagements_status ON engagements(status);
  UPDATE engagements SET end_date = NULL WHERE historical = 0 AND id LIKE 'e%' AND id NOT LIKE 'eng%'
  `,
    postgres: `
  ALTER TABLE engagements ALTER COLUMN end_date DROP NOT NULL;
  UPDATE engagements SET end_date = NULL WHERE historical = 0 AND id LIKE 'e%' AND id NOT LIKE 'eng%'
  `,
  },
  // 3: work email per person, for new-project notifications.
  `ALTER TABLE talents ADD COLUMN email TEXT`,
];

/** Postgres flavour of the schema: same tables and columns, Postgres types. */
function pgDdl(sqlite: string): string {
  return sqlite
    .replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, 'SERIAL PRIMARY KEY')
    .replace(/ COLLATE NOCASE/g, '')
    .replace(/ REAL,/g, ' DOUBLE PRECISION,')
    // Postgres has no rowid; seq keeps insertion order for listings.
    .replace(/CREATE TABLE (talents|engagements|clients) \(/g, 'CREATE TABLE $1 (\n    seq BIGSERIAL,');
}

/** Open the database named by `url`: postgres://… (Neon etc.), libsql://… (Turso), or a local file path. */
export function openDb(url: string, authToken?: string): DB {
  if (/^postgres(ql)?:\/\//.test(url)) return postgresDb(pgPool(url));
  if (url !== ':memory:' && !/^[a-z]+:/.test(url)) {
    // A bare path: make sure its folder exists and turn it into a file: URL.
    fs.mkdirSync(path.dirname(path.resolve(url)), { recursive: true });
    url = 'file:' + url;
  }
  return sqliteDb(url, authToken);
}

/** Column that preserves insertion order for listings. */
export const insertionOrder = (db: DB) => (db.dialect === 'postgres' ? 'seq' : 'rowid');

/** Apply any pending schema migrations. Safe to run on every cold start. */
export async function migrate(db: DB): Promise<void> {
  await db.execute('CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  const ddl = MIGRATIONS.map((m) => (typeof m === 'string' ? (db.dialect === 'postgres' ? pgDdl(m) : m) : m[db.dialect]));
  const done = new Set((await db.execute('SELECT version FROM _migrations')).rows.map((r) => Number(r.version)));
  for (let v = 0; v < MIGRATIONS.length; v++) {
    if (done.has(v + 1)) continue;
    const stmts = ddl[v].split(';').map((x) => x.trim()).filter(Boolean);
    await db.batch([...stmts, { sql: 'INSERT INTO _migrations (version, applied_at) VALUES (?, ?) ON CONFLICT DO NOTHING', args: [v + 1, new Date().toISOString()] }], 'write');
  }
}

/** Run `fn` inside a write transaction. */
export function inTransaction<T>(db: DB, fn: (tx: Exec) => Promise<T>): Promise<T> {
  return db.transaction(fn);
}

export async function one<T = Row>(ex: Exec, sql: string, args: unknown[] = []): Promise<T | undefined> {
  return (await ex.execute({ sql, args })).rows[0] as T | undefined;
}
export async function all<T = Row>(ex: Exec, sql: string, args: unknown[] = []): Promise<T[]> {
  return (await ex.execute({ sql, args })).rows as unknown as T[];
}
export async function run(ex: Exec, sql: string, args: unknown[] = []): Promise<void> {
  await ex.execute({ sql, args });
}

/** Portable insert-or-update. */
function upsert(table: string, keys: string[], cols: string[], args: unknown[]): Stmt {
  const updates = cols.filter((c) => !keys.includes(c)).map((c) => `${c}=excluded.${c}`).join(', ');
  return { sql: `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')}) ON CONFLICT (${keys.join(',')}) DO UPDATE SET ${updates}`, args };
}

// ---------- row mapping ----------
const json = <T>(s: string | null): T | null => (s ? (JSON.parse(s) as T) : null);


export const talentFromRow = (r: Row): Talent => ({
  id: r.id, name: r.name, initials: r.initials, title: r.title, department: r.department, status: r.status,
  utilOverride: json(r.util_override), flag: json(r.flag), createdAt: r.created_at, updatedAt: r.updated_at, email: r.email ?? null,
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
interface EntityRow { table: string; keys: string[]; cols: string[]; args: unknown[] }

/** Table, key columns, columns and values for one entity. */
function entityRow(type: EntityType, value: Entity): EntityRow {
  switch (type) {

    case 'talent': {
      const t = value as Talent;
      return row('talents', ['id'], ['id', 'name', 'initials', 'title', 'department', 'status', 'util_override', 'flag', 'created_at', 'updated_at', 'email'], [t.id, t.name, t.initials, t.title, t.department, t.status, t.utilOverride ? JSON.stringify(t.utilOverride) : null, t.flag ? JSON.stringify(t.flag) : null, t.createdAt, t.updatedAt, t.email ?? null]);
    }
    case 'engagement': {
      const e = value as Engagement;
      return row('engagements', ['id'], ['id', 'name', 'client', 'country', 'sector', 'scope', 'sub_scope', 'stage', 'lead_id', 'team_ids', 'supervisor_id',
        'start_date', 'end_date', 'notes', 'workload_tier', 'custom_cps', 'price', 'cost', 'status', 'historical', 'allocation_overrides', 'created_at', 'updated_at'], [e.id, e.name, e.client, e.country, e.sector, e.scope, e.subScope, e.stage, e.leadId, JSON.stringify(e.teamIds), e.supervisorId,
          e.start, e.end, e.notes, e.workloadTier, e.customCps ? JSON.stringify(e.customCps) : null, e.price, e.cost, e.status,
          e.historical ? 1 : 0, JSON.stringify(e.allocationOverrides ?? {}), e.createdAt, e.updatedAt]);
    }
    case 'client': {
      const c = value as Client;
      return row('clients', ['id'], ['id', 'name', 'industry', 'country', 'owner'], [c.id, c.name, c.industry, c.country, c.owner]);
    }
    case 'capacityRule': {
      const r = value as CapacityRule;
      return row('capacity_rules', ['title', 'department'], ['title', 'department', 'project', 'leadership', 'placeholder'], [r.title, r.department, r.project, r.leadership, r.placeholder ? 1 : 0]);
    }
  }
}

/** Statement that inserts-or-replaces one entity, or deletes it when `value` is null. */
export function putStatement(type: EntityType, id: string, value: Entity | null): Stmt {
  if (value === null) {
    if (type === 'capacityRule') {
      const [title, department] = id.split('__');
      return { sql: 'DELETE FROM capacity_rules WHERE title=? AND department=?', args: [title, department] };
    }
    const table = { talent: 'talents', engagement: 'engagements', client: 'clients' }[type];
    return { sql: `DELETE FROM ${table} WHERE id=?`, args: [id] };
  }
  const r = entityRow(type, value);
  return upsert(r.table, r.keys, r.cols, r.args);
}
const row = (table: string, keys: string[], cols: string[], args: unknown[]): EntityRow => ({ table, keys, cols, args });

/** Plain multi-row INSERTs, chunked — one round trip per chunk instead of per row. */
function bulkInsert(table: string, cols: string[], rows: unknown[][], chunk = 100): Stmt[] {
  const out: Stmt[] = [];
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    const one = '(' + cols.map(() => '?').join(',') + ')';
    out.push({ sql: `INSERT INTO ${table} (${cols.join(',')}) VALUES ${part.map(() => one).join(',')}`, args: part.flat() });
  }
  return out;
}

export async function putEntity(ex: Exec, type: EntityType, id: string, value: Entity | null): Promise<void> {
  await ex.execute(putStatement(type, id, value));
}

export async function getMeta(ex: Exec, key: string): Promise<string | null> {
  return (await one<{ value: string }>(ex, 'SELECT value FROM meta WHERE key=?', [key]))?.value ?? null;
}
export function setMetaStatement(key: string, value: string): Stmt {
  return upsert('meta', ['key'], ['key', 'value'], [key, value]);
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
  const stmts: StmtLike[] = ['talents', 'engagements', 'clients', 'capacity_rules', 'trajectory', 'audit_log'].map((t) => `DELETE FROM ${t}`);
  const bulk = (type: EntityType, items: Entity[]) => {
    if (!items.length) return;
    const first = entityRow(type, items[0]);
    stmts.push(...bulkInsert(first.table, first.cols, items.map((x) => entityRow(type, x).args)));
  };
  bulk('talent', seed.talents);
  bulk('engagement', seed.engagements);
  bulk('client', seed.clients);
  bulk('capacityRule', seed.capacityRules);
  stmts.push(...bulkInsert('trajectory', ['year', 'month', 'engagement', 'sector', 'scope', 'status', 'talent', 'talent_id', 'title', 'role', 'client'],
    seed.trajectory.map((r) => [r.year, r.month, r.engagement, r.sector, r.scope, r.status, r.talent, r.talentId, r.title, r.role, r.client])));
  stmts.push(...bulkInsert('audit_log', ['at', 'user_id', 'user_name', 'action', 'entity_type', 'entity_id', 'entity_name', 'details'],
    (seed.audit ?? []).map((a) => [a.at, null, a.userName, a.action, 'imported', '', a.entityName, a.details])));
  stmts.push(setMetaStatement('version', String(version)), setMetaStatement('updatedAt', new Date().toISOString()), setMetaStatement('updatedBy', 'Seed: ' + seed.description));
  await db.batch(stmts, 'write');
}
