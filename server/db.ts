import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import type { CapacityRule, Client, Engagement, SeedFile, Talent, TrajectoryRow } from '../shared/types';

export type DB = Database.Database;

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
  CREATE INDEX engagements_status ON engagements(status);
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
  CREATE INDEX audit_entity ON audit_log(entity_type, entity_id);
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `,
];

export function openDb(file: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
  return db;
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

export function getEntity(db: DB, type: EntityType, id: string): Entity | null {
  switch (type) {
    case 'talent': { const r = db.prepare('SELECT * FROM talents WHERE id=?').get(id) as Row | undefined; return r ? talentFromRow(r) : null; }
    case 'engagement': { const r = db.prepare('SELECT * FROM engagements WHERE id=?').get(id) as Row | undefined; return r ? engagementFromRow(r) : null; }
    case 'client': { const r = db.prepare('SELECT * FROM clients WHERE id=?').get(id) as Client | undefined; return r ?? null; }
    case 'capacityRule': {
      const [title, department] = id.split('__');
      const r = db.prepare('SELECT * FROM capacity_rules WHERE title=? AND department=?').get(title, department) as Row | undefined;
      return r ? ruleFromRow(r) : null;
    }
  }
}

export function entityId(type: EntityType, e: Entity): string {
  return type === 'capacityRule' ? (e as CapacityRule).title + '__' + (e as CapacityRule).department : (e as Talent).id;
}

/** Insert-or-replace one entity, or delete it when `value` is null. */
export function putEntity(db: DB, type: EntityType, id: string, value: Entity | null): void {
  if (value === null) {
    if (type === 'capacityRule') {
      const [title, department] = id.split('__');
      db.prepare('DELETE FROM capacity_rules WHERE title=? AND department=?').run(title, department);
    } else {
      const table = { talent: 'talents', engagement: 'engagements', client: 'clients' }[type];
      db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id);
    }
    return;
  }
  switch (type) {
    case 'talent': {
      const t = value as Talent;
      db.prepare(`INSERT OR REPLACE INTO talents (id,name,initials,title,department,status,util_override,flag,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(t.id, t.name, t.initials, t.title, t.department, t.status,
        t.utilOverride ? JSON.stringify(t.utilOverride) : null, t.flag ? JSON.stringify(t.flag) : null, t.createdAt, t.updatedAt);
      return;
    }
    case 'engagement': {
      const e = value as Engagement;
      db.prepare(`INSERT OR REPLACE INTO engagements (id,name,client,country,sector,scope,sub_scope,stage,lead_id,team_ids,supervisor_id,
        start_date,end_date,notes,workload_tier,custom_cps,price,cost,status,historical,allocation_overrides,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(e.id, e.name, e.client, e.country, e.sector, e.scope, e.subScope,
        e.stage, e.leadId, JSON.stringify(e.teamIds), e.supervisorId, e.start, e.end, e.notes, e.workloadTier,
        e.customCps ? JSON.stringify(e.customCps) : null, e.price, e.cost, e.status, e.historical ? 1 : 0,
        JSON.stringify(e.allocationOverrides ?? {}), e.createdAt, e.updatedAt);
      return;
    }
    case 'client': {
      const c = value as Client;
      db.prepare('INSERT OR REPLACE INTO clients (id,name,industry,country,owner) VALUES (?,?,?,?,?)').run(c.id, c.name, c.industry, c.country, c.owner);
      return;
    }
    case 'capacityRule': {
      const r = value as CapacityRule;
      db.prepare('INSERT OR REPLACE INTO capacity_rules (title,department,project,leadership,placeholder) VALUES (?,?,?,?,?)')
        .run(r.title, r.department, r.project, r.leadership, r.placeholder ? 1 : 0);
      return;
    }
  }
}

export function getMeta(db: DB, key: string): string | null {
  return (db.prepare('SELECT value FROM meta WHERE key=?').get(key) as { value: string } | undefined)?.value ?? null;
}
export function setMeta(db: DB, key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO meta (key,value) VALUES (?,?)').run(key, value);
}

export function isEmpty(db: DB): boolean {
  return (db.prepare('SELECT COUNT(*) n FROM talents').get() as { n: number }).n === 0;
}

/** Replace all business data with a seed file. Users and sessions are kept. */
export function loadSeed(db: DB, seed: SeedFile): void {
  db.transaction(() => {
    for (const t of ['talents', 'engagements', 'clients', 'capacity_rules', 'trajectory', 'audit_log']) db.prepare(`DELETE FROM ${t}`).run();
    seed.talents.forEach((t) => putEntity(db, 'talent', t.id, t));
    seed.engagements.forEach((e) => putEntity(db, 'engagement', e.id, e));
    seed.clients.forEach((c) => putEntity(db, 'client', c.id, c));
    seed.capacityRules.forEach((r) => putEntity(db, 'capacityRule', r.title + '__' + r.department, r));
    const ins = db.prepare('INSERT INTO trajectory (year,month,engagement,sector,scope,status,talent,talent_id,title,role,client) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
    seed.trajectory.forEach((r) => ins.run(r.year, r.month, r.engagement, r.sector, r.scope, r.status, r.talent, r.talentId, r.title, r.role, r.client));
    const audit = db.prepare(`INSERT INTO audit_log (at,user_id,user_name,action,entity_type,entity_id,entity_name,details) VALUES (?,?,?,?,?,?,?,?)`);
    (seed.audit ?? []).forEach((a) => audit.run(a.at, null, a.userName, a.action, 'imported', '', a.entityName, a.details));
    const version = Number(getMeta(db, 'version') ?? 0) + 1;
    setMeta(db, 'version', String(version));
    setMeta(db, 'updatedAt', new Date().toISOString());
    setMeta(db, 'updatedBy', 'Seed: ' + seed.description);
  })();
}
