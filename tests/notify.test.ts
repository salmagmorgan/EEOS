import fs from 'node:fs';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { DEFAULT_NOTIFICATION_SETTINGS, TEMPLATE_FIELDS, buildProjectEmail, emailAsText, fieldKey, mailtoLink, outlookAppLink, outlookWebLink, parseEmailImport, unknownPlaceholders } from '../shared/notify';
import { createApp } from '../server/app';
import { createUser } from '../server/auth';
import { loadSeed, migrate, openDb } from '../server/db';
import { createMailer } from '../server/mailer';

const people: Record<string, { name: string; department: string; email: string | null }> = {
  l: { name: 'Lina Lead', department: 'Consulting', email: 'lina@tbc.test' },
  m: { name: 'Omar Member', department: 'Pulse', email: 'omar@tbc.test' },
  o: { name: 'Hala Ops', department: 'Operations', email: null },
  s: { name: 'Sam Sup', department: 'Consulting', email: 'sam@tbc.test' },
};
const mail = buildProjectEmail(
  { name: 'Brand & Growth', client: 'Atlas', sector: 'Retail', scope: 'Strategy', start: '2026-11-10', end: null, leadId: 'l', teamIds: ['l', 'm', 'o'], supervisorId: 's' },
  (id) => people[id], { ...DEFAULT_NOTIFICATION_SETTINGS, committee: ['PMO@tbc.test'] },
);

describe('one-click email links', () => {
  it('fills the template and lists people without an email', () => {
    expect(mail.to).toEqual(['lina@tbc.test', 'omar@tbc.test', 'sam@tbc.test']);
    expect(mail.cc).toEqual(['pmo@tbc.test']);
    expect(mail.missing).toEqual(['Hala Ops']);
    expect(mail.body).toContain('Engagement members: Omar Member\nOperations member: Hala Ops\nSupervisor: Sam Sup');
  });
  it('builds a mailto link that round-trips subject, body and recipients', () => {
    const url = new URL(mailtoLink(mail));
    expect(url.protocol).toBe('mailto:');
    expect(url.pathname).toBe('lina@tbc.test,omar@tbc.test,sam@tbc.test');
    expect(url.searchParams.get('cc')).toBe('pmo@tbc.test');
    expect(url.searchParams.get('subject')).toBe('New project commissioned: Brand & Growth');
    expect(url.searchParams.get('body')!.replace(/\r\n/g, '\n')).toBe(mail.body);
  });
  it('builds an Outlook on the web compose link', () => {
    const url = new URL(outlookWebLink(mail));
    expect(url.origin + url.pathname).toBe('https://outlook.office.com/mail/deeplink/compose');
    expect(url.searchParams.get('to')).toBe('lina@tbc.test,omar@tbc.test,sam@tbc.test');
    expect(url.searchParams.get('cc')).toBe('pmo@tbc.test');
    expect(url.searchParams.get('body')).toBe(mail.body);
  });
  it('has a plain-text copy', () => {
    expect(emailAsText(mail)).toMatch(/^To: lina@tbc.test; omar@tbc.test; sam@tbc.test\nCc: pmo@tbc.test\nSubject: New project commissioned: Brand & Growth\n\nHello team,/);
  });
});

describe('one-click mode (no sending account connected)', () => {
  it('creates the engagement and hands the email to the browser instead of failing', async () => {
    const db = openDb(':memory:');
    await migrate(db);
    await loadSeed(db, JSON.parse(fs.readFileSync('server/seed/demo-seed.json', 'utf8')));
    await createUser(db, { name: 'Ada Admin', email: 'admin@test.dev', role: 'admin', password: 'correct-horse-1' });
    const app = createApp(db, { cookieSecure: false, demoSeedPath: 'server/seed/demo-seed.json', copilotModel: 'claude-opus-5-5', mailer: createMailer({}) });
    const agent = request.agent(app);
    await agent.post('/api/auth/login').set('X-EEOS', '1').send({ email: 'admin@test.dev', password: 'correct-horse-1' }).expect(200);
    const w = (await agent.get('/api/workspace')).body;
    const lead = w.talents.find((t: { status: string; department: string }) => t.status === 'active' && t.department === 'Consulting');
    await agent.patch(`/api/talents/${lead.id}`).set('X-EEOS', '1').send({ email: 'lead@tbc.test' }).expect(200);
    const res = await agent.post('/api/engagements').set('X-EEOS', '1').send({ name: 'Manual', client: 'C', sector: 'Retail', scope: 'Research', leadId: lead.id }).expect(200);
    expect(res.body.email).toMatchObject({ sent: false, manual: true, to: ['lead@tbc.test'] });
    expect((await agent.get(`/api/engagements/${res.body.engagement.id}/notify`)).body.sender).toBeNull();
    await agent.post(`/api/engagements/${res.body.engagement.id}/notify/opened`).set('X-EEOS', '1').send({ app: 'outlook-web' }).expect(200);
    const audit = (await agent.get('/api/audit')).body.entries;
    expect(audit[0]).toMatchObject({ action: 'Opened new-project email to send', entityName: 'Manual' });
    expect(audit.some((a: { action: string }) => a.action === 'New-project email failed')).toBe(false);
  });
});

describe('sending from the planning mailbox', () => {
  const fromPlanning = buildProjectEmail(
    { name: 'P', client: 'C', sector: 'Retail', scope: 'Research', start: '2026-11-10', end: null, leadId: 'l', teamIds: ['l', 'm'], supervisorId: null },
    (id) => people[id], { ...DEFAULT_NOTIFICATION_SETTINGS, committee: ['Planning@tbc.test', 'pmo@tbc.test'], sendFrom: 'Planning@TBC.test' },
  );
  it('sets From and drops the sending mailbox from Cc', () => {
    expect(fromPlanning.from).toBe('planning@tbc.test');
    expect(fromPlanning.cc).toEqual(['pmo@tbc.test']);
  });
  it('opens Outlook on the web inside that mailbox', () => {
    const url = new URL(outlookWebLink(fromPlanning));
    expect(url.pathname).toBe('/mail/planning%40tbc.test/deeplink/compose');
    expect(url.searchParams.get('to')).toBe('lina@tbc.test,omar@tbc.test');
    expect(new URL(outlookWebLink({ ...fromPlanning, from: null })).pathname).toBe('/mail/deeplink/compose');
    expect(emailAsText(fromPlanning).startsWith('From: planning@tbc.test\nTo: lina@tbc.test; omar@tbc.test')).toBe(true);
  });
  it('without a Send-from mailbox nothing changes', () => {
    expect(mail.from).toBeNull();
    expect(new URL(outlookWebLink(mail)).pathname).toBe('/mail/deeplink/compose');
  });
});

describe('template fields are forgiving', () => {
  const e = { name: 'Brand & Growth', client: 'Atlas', sector: 'Retail', scope: 'Strategy', start: '2026-11-10', end: null, leadId: 'l', teamIds: ['l', 'm', 'o'], supervisorId: 's' };
  it('fills {{Project Name}}, {{project name}}, {{project-name}} and {{ PROJECT_NAME }}', () => {
    const out = buildProjectEmail(e, (id) => people[id], { ...DEFAULT_NOTIFICATION_SETTINGS, subject: 'A {{Project Name}} B {{project name}} C {{project-name}} D {{ PROJECT_NAME }} E {{client}} F {{Engagement Leader}}' });
    expect(out.subject).toBe('A Brand & Growth B Brand & Growth C Brand & Growth D Brand & Growth E Atlas F Lina Lead');
  });
  it('every documented field resolves, and unknown ones are reported', () => {
    TEMPLATE_FIELDS.forEach((f) => expect(fieldKey(f.key)).toBe(f.key));
    expect(unknownPlaceholders('Hi {{project name}} {{budget}} {{Client}}')).toEqual(['{{budget}}']);
    expect(unknownPlaceholders(DEFAULT_NOTIFICATION_SETTINGS.subject + DEFAULT_NOTIFICATION_SETTINGS.body)).toEqual([]);
  });
  it('builds an Outlook app link', () => {
    const url = new URL(outlookAppLink(mail));
    expect(url.protocol).toBe('ms-outlook:');
    expect(url.searchParams.get('to')).toBe('lina@tbc.test,omar@tbc.test,sam@tbc.test');
    expect(url.searchParams.get('subject')).toBe('New project commissioned: Brand & Growth');
    expect(url.searchParams.get('body')).toBe(mail.body);
  });
});

describe('bulk email import', () => {
  const roster = [
    { id: 'a', name: 'Ahmed Hisham', email: null },
    { id: 'b', name: 'Sarah El Saadany', email: 's.elsaadany@tbc.test' },
    { id: 'c', name: 'Alia El Mistikawi', email: 'old@tbc.test' },
  ];
  it('matches names, keeps existing emails and flags problems', () => {
    const rows = parseEmailImport([
      'Name\tEmail',
      'ahmed hisham\tA.Hesham@TBC.test',
      'Sarah El-Saadany, s.elsaadany@tbc.test',
      'Alia El Mistikawi; new@tbc.test',
      'Someone Else, x@tbc.test',
      'Ahmed Hisham, not-an-email',
      '',
    ].join('\n'), roster);
    expect(rows.map((r) => [r.name, r.email, r.status])).toEqual([
      ['Ahmed Hisham', 'a.hesham@tbc.test', 'fill'],
      ['Sarah El Saadany', 's.elsaadany@tbc.test', 'same'],
      ['Alia El Mistikawi', 'new@tbc.test', 'keep'],
      ['Someone Else', 'x@tbc.test', 'unmatched'],
      ['Ahmed Hisham not-an-email', '', 'invalid'],
    ]);
  });
});

describe('emlFile', () => {
  it('builds an unsent Outlook draft with From, recipients and a UTF-8 body', async () => {
    const { emlFile } = await import('../shared/notify');
    const eml = emlFile({ from: 'planning@x.com', to: ['a@x.com'], cc: ['c@x.com'], subject: 'New project: Café', body: 'Hello team,\nLine 2' });
    expect(eml.startsWith('X-Unsent: 1\r\nFrom: planning@x.com\r\nTo: a@x.com\r\nCc: c@x.com\r\n')).toBe(true);
    expect(eml).toContain('Subject: =?UTF-8?B?');
    const body = eml.split('\r\n\r\n')[1].replace(/\r\n/g, '');
    expect(Buffer.from(body, 'base64').toString('utf8')).toBe('Hello team,\r\nLine 2');
  });
});
