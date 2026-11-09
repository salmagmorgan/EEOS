import fs from 'node:fs';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../server/app';
import { createUser } from '../server/auth';
import { loadSeed, openDb } from '../server/db';

const db = openDb(':memory:');
loadSeed(db, JSON.parse(fs.readFileSync('server/seed/demo-seed.json', 'utf8')));
createUser(db, { name: 'Ada Admin', email: 'admin@test.dev', role: 'admin', password: 'correct-horse-1' });
createUser(db, { name: 'Vic Viewer', email: 'viewer@test.dev', role: 'viewer', password: 'correct-horse-2' });
const app = createApp(db, { cookieSecure: false, demoSeedPath: 'server/seed/demo-seed.json', copilotModel: 'claude-opus-5-5' });

const login = async (email: string, password: string) => {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').set('X-EEOS', '1').send({ email, password }).expect(200);
  return agent;
};

describe('API', () => {
  let admin: Awaited<ReturnType<typeof login>>;
  let viewer: Awaited<ReturnType<typeof login>>;
  beforeAll(async () => {
    admin = await login('admin@test.dev', 'correct-horse-1');
    viewer = await login('viewer@test.dev', 'correct-horse-2');
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

  it('validates input', async () => {
    const res = await admin.post('/api/engagements').set('X-EEOS', '1').send({ name: '', client: 'C', sector: 'S', scope: 'Research', leadId: 'nobody' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name/);
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
