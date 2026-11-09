import fs from 'node:fs';
import request from 'supertest';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../server/app';
import { createUser } from '../server/auth';
import { type DB, type PgLike, loadSeed, migrate, openDb, postgresDb } from '../server/db';
import type { MailMessage } from '../server/mailer';

/** In-process Postgres, so the Postgres code path is tested without a server. */
function pglite(): DB {
  const pg = new PGlite();
  const conn: PgLike = {
    query: (t, p) => pg.query(t, p as unknown[]) as Promise<{ rows: Record<string, unknown>[] }>,
    inTransaction: (fn) => pg.transaction((tx) => fn((t, p) => tx.query(t, p as unknown[]) as Promise<{ rows: Record<string, unknown>[] }>)),
    end: () => pg.close(),
  };
  return postgresDb(conn);
}

describe.each([
  ['SQLite', () => openDb(':memory:')],
  ['Postgres', pglite],
])('API on %s', (_name, makeDb) => {
  let app: ReturnType<typeof createApp>;
  let admin: request.Agent;
  let viewer: request.Agent;
  const outbox: MailMessage[] = [];
  let mailFails = false;
  const mailer = { from: 'eeos@test.dev', send: async (m: MailMessage) => { if (mailFails) throw new Error('SMTP down'); outbox.push(m); } };
  const login = async (email: string, password: string) => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').set('X-EEOS', '1').send({ email, password }).expect(200);
    return agent;
  };
  beforeAll(async () => {
    const db = makeDb();
    await migrate(db);
    await migrate(db); // idempotent
    await loadSeed(db, JSON.parse(fs.readFileSync('server/seed/demo-seed.json', 'utf8')));
    await createUser(db, { name: 'Ada Admin', email: 'admin@test.dev', role: 'admin', password: 'correct-horse-1' });
    await createUser(db, { name: 'Vic Viewer', email: 'viewer@test.dev', role: 'viewer', password: 'correct-horse-2' });
    app = createApp(db, { cookieSecure: false, demoSeedPath: 'server/seed/demo-seed.json', copilotModel: 'claude-opus-5-5', mailer });
    admin = await login('admin@test.dev', 'correct-horse-1');
    viewer = await login('viewer@test.dev', 'correct-horse-2');
  }, 60_000);

  it('loads the seed with insertion order and types intact', async () => {
    const w = (await viewer.get('/api/workspace').expect(200)).body;
    const seed = JSON.parse(fs.readFileSync('server/seed/demo-seed.json', 'utf8'));
    expect(w.talents.map((t: { id: string }) => t.id)).toEqual(seed.talents.map((t: { id: string }) => t.id));
    expect(w.engagements).toHaveLength(seed.engagements.length);
    expect(typeof w.trajectory[0].year).toBe('number');
    expect(typeof w.trajectory[0].id).toBe('number');
    expect(typeof w.engagements[0].historical).toBe('boolean');
  });

  it('requires sign-in', async () => {
    await request(app).get('/api/workspace').expect(401);
    await request(app).post('/api/auth/login').set('X-EEOS', '1').send({ email: 'admin@test.dev', password: 'nope' }).expect(401);
  });

  it('rejects state changes without the CSRF header', async () => {
    await admin.post('/api/talents').send({ name: 'X Y', title: 'Consultant', department: 'Consulting' }).expect(403);
  });

  it('lets viewers read but not write', async () => {
    const w = await viewer.get('/api/workspace').expect(200);
    expect(w.body.talents.length).toBeGreaterThan(10);
    await viewer.post('/api/talents').set('X-EEOS', '1').send({ name: 'X Y', title: 'Consultant', department: 'Consulting' }).expect(403);
  });

  it('creates an engagement, audits it, and undoes it', async () => {
    const w = (await admin.get('/api/workspace')).body;
    const people = w.talents.filter((t: { status: string; department: string }) => t.status === 'active' && t.department !== 'Operations');
    const res = await admin.post('/api/engagements').set('X-EEOS', '1').send({
      name: 'Test Engagement', client: 'Brand New Client', sector: 'Retail', scope: 'Strategy', leadId: people[0].id,
      teamIds: [people[1].id], supervisorId: people[2].id, start: '2026-11-01', end: '2027-01-31', workloadTier: 'Heavy & Complex',
    }).expect(200);
    const id = res.body.engagement.id;
    expect(res.body.engagement.teamIds).toEqual([people[1].id]);
    expect(res.body.engagement.stage).toBe('kickoff');

    await admin.post(`/api/engagements/${id}/advance`).set('X-EEOS', '1').expect(200);
    const audit = (await admin.get('/api/audit')).body;
    expect(audit.entries[0].action).toBe('Advanced stage');
    expect(audit.entries.some((a: { action: string; entityName: string }) => a.action === 'Added client' && a.entityName === 'Brand New Client')).toBe(true);

    // Undoing the creation first must be refused (it changed since); undo newest first.
    const created = audit.entries.find((a: { action: string }) => a.action === 'Created engagement');
    await admin.post(`/api/audit/${created.id}/undo`).set('X-EEOS', '1').expect(409);
    await admin.post('/api/audit/undo-last').set('X-EEOS', '1').expect(200);
    await admin.post(`/api/audit/${created.id}/undo`).set('X-EEOS', '1').expect(200);
    const after = (await admin.get('/api/workspace')).body;
    expect(after.engagements.some((e: { id: string }) => e.id === id)).toBe(false);
  });

  it('enforces status transitions and protects historical records', async () => {
    const w = (await admin.get('/api/workspace')).body;
    const active = w.engagements.find((e: { status: string; historical: boolean }) => e.status === 'active' && !e.historical);
    const hist = w.engagements.find((e: { historical: boolean }) => e.historical);
    await admin.post(`/api/engagements/${active.id}/reopen`).set('X-EEOS', '1').expect(409);
    await admin.post(`/api/engagements/${active.id}/pause`).set('X-EEOS', '1').expect(200);
    await admin.post(`/api/engagements/${active.id}/resume`).set('X-EEOS', '1').expect(200);
    await admin.post(`/api/engagements/${hist.id}/delete`).set('X-EEOS', '1').expect(409);
    await admin.put(`/api/engagements/${hist.id}/financials`).set('X-EEOS', '1').send({ price: 1000, cost: 400 }).expect(200);
  });

  it('creates engagements without an end date and never fills one in', async () => {
    const w = (await admin.get('/api/workspace')).body;
    const lead = w.talents.find((t: { status: string; department: string }) => t.status === 'active' && t.department !== 'Operations');
    const res = await admin.post('/api/engagements').set('X-EEOS', '1').send({ name: 'Open-ended', client: 'C1', sector: 'Retail', scope: 'Research', leadId: lead.id, start: '2026-11-01' }).expect(200);
    expect(res.body.engagement.end).toBeNull();
    expect(res.body.engagement.customCps).toBeNull();
    const id = res.body.engagement.id;
    const set = await admin.patch(`/api/engagements/${id}`).set('X-EEOS', '1').send({ end: '2027-03-01' }).expect(200);
    expect(set.body.engagement.end).toBe('2027-03-01');
    const cleared = await admin.patch(`/api/engagements/${id}`).set('X-EEOS', '1').send({ end: null }).expect(200);
    expect(cleared.body.engagement.end).toBeNull();
    await admin.patch(`/api/engagements/${id}`).set('X-EEOS', '1').send({ end: '2026-10-01' }).expect(400);
  });

  it('emails the new-project template to the team and planning committee', async () => {
    const w = (await admin.get('/api/workspace')).body;
    const act = w.talents.filter((t: { status: string }) => t.status === 'active');
    const lead = act.find((t: { department: string }) => t.department === 'Consulting');
    const member = act.find((t: { department: string; id: string }) => t.department === 'Consulting' && t.id !== lead.id);
    const ops = act.find((t: { department: string }) => t.department === 'Operations');
    const sup = act.find((t: { department: string; id: string }) => t.department !== 'Operations' && t.id !== lead.id && t.id !== member.id);
    const noEmail = act.find((t: { department: string; id: string }) => t.department === 'Pulse' && ![lead.id, member.id, sup.id].includes(t.id));
    for (const [t, email] of [[lead, 'Lead@TBC.test'], [member, 'member@tbc.test'], [ops, 'ops@tbc.test'], [sup, 'sup@tbc.test']])
      await admin.patch(`/api/talents/${t.id}`).set('X-EEOS', '1').send({ email }).expect(200);
    await admin.patch(`/api/talents/${lead.id}`).set('X-EEOS', '1').send({ email: 'not-an-email' }).expect(400);
    await viewer.put('/api/settings/notifications').set('X-EEOS', '1').send({}).expect(403);
    const defaults = (await admin.get('/api/settings/notifications').expect(200)).body.defaults;
    await admin.put('/api/settings/notifications').set('X-EEOS', '1').send({ ...defaults, committee: ['Committee@TBC.test', 'pmo@tbc.test'] }).expect(200);

    outbox.length = 0;
    const res = await admin.post('/api/engagements').set('X-EEOS', '1').send({
      name: 'Email Test Project', client: 'Mail Client', sector: 'Retail', scope: 'Research', leadId: lead.id,
      teamIds: [lead.id, member.id, ops.id, noEmail.id], supervisorId: sup.id, start: '2026-11-10',
    }).expect(200);
    expect(res.body.email.sent).toBe(true);
    expect(res.body.email.missing).toEqual([noEmail.name]);
    expect(outbox).toHaveLength(1);
    const m = outbox[0];
    expect(m.to.sort()).toEqual(['lead@tbc.test', 'member@tbc.test', 'ops@tbc.test', 'sup@tbc.test']);
    expect(m.cc).toEqual(['committee@tbc.test', 'pmo@tbc.test']);
    expect(m.subject).toBe('New project commissioned: Email Test Project');
    expect(m.text).toContain('Hello team,');
    expect(m.text).toContain('Project name: Email Test Project');
    expect(m.text).toContain('Client name: Mail Client');
    expect(m.text).toContain(`Engagement Leader: ${lead.name}`);
    expect(m.text).toContain(`Engagement members: ${member.name}, ${noEmail.name}`);
    expect(m.text).toContain(`Operations member: ${ops.name}`);
    expect(m.text).toContain(`Supervisor: ${sup.name}`);
    const audit = (await admin.get('/api/audit')).body.entries;
    expect(audit[0].action).toBe('Sent new-project email');

    // Opt-out, failures and resending
    outbox.length = 0;
    const quiet = await admin.post('/api/engagements').set('X-EEOS', '1').send({ name: 'Quiet', client: 'Mail Client', sector: 'Retail', scope: 'Research', leadId: lead.id, notify: false }).expect(200);
    expect(quiet.body.email).toBeNull();
    expect(outbox).toHaveLength(0);
    mailFails = true;
    const failed = await admin.post('/api/engagements').set('X-EEOS', '1').send({ name: 'Fails', client: 'Mail Client', sector: 'Retail', scope: 'Research', leadId: lead.id }).expect(200);
    expect(failed.body.engagement.id).toBeTruthy();
    expect(failed.body.email).toMatchObject({ sent: false, error: 'SMTP down' });
    mailFails = false;
    const resent = await admin.post(`/api/engagements/${failed.body.engagement.id}/notify`).set('X-EEOS', '1').expect(200);
    expect(resent.body.result.sent).toBe(true);
    await viewer.post(`/api/engagements/${failed.body.engagement.id}/notify`).set('X-EEOS', '1').expect(403);
  });

  it('validates input', async () => {
    const res = await admin.post('/api/engagements').set('X-EEOS', '1').send({ name: '', client: 'C', sector: 'S', scope: 'Research', leadId: 'nobody' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name/);
  });

  it('reports the workspace version for change polling', async () => {
    const before = (await viewer.get('/api/version').expect(200)).body.version;
    const w = (await admin.get('/api/workspace')).body;
    await admin.put(`/api/talents/${w.talents[0].id}/flag`).set('X-EEOS', '1').send({ flagged: true }).expect(200);
    expect((await viewer.get('/api/version')).body.version).toBe(before + 1);
  });

  it('exports CSV', async () => {
    const res = await viewer.get('/api/export/talents.csv').expect(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.text).toContain('name,title,department');
  });

  it('lets only admins manage users', async () => {
    await viewer.get('/api/users').expect(403);
    const res = await admin.post('/api/users').set('X-EEOS', '1').send({ name: 'Ed', email: 'ed@test.dev', role: 'editor', password: 'short' });
    expect(res.status).toBe(400);
    await admin.post('/api/users').set('X-EEOS', '1').send({ name: 'Ed', email: 'ed@test.dev', role: 'editor', password: 'long-enough-pw' }).expect(200);
  });
});
