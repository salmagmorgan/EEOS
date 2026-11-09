/* The "new project commissioned" email: template, fields and recipients.
   Shared so the web app can preview exactly what the server will send. */
import type { Engagement, NotificationSettings, Talent } from './types.js';

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: true,
  committee: [],
  subject: 'New project commissioned: {{project_name}}',
  body: `Hello team,

Hope all is well.

Kindly note that a new project has been commissioned, please find details below:

Project name: {{project_name}}
Client name: {{client_name}}
Engagement Leader: {{engagement_leader}}
Engagement members: {{engagement_members}}
Operations member: {{operations_members}}
Supervisor: {{supervisor}}`,
};

export const TEMPLATE_FIELDS: { key: string; label: string }[] = [
  { key: 'project_name', label: 'Project name' },
  { key: 'client_name', label: 'Client name' },
  { key: 'engagement_leader', label: 'Engagement leader' },
  { key: 'engagement_members', label: 'Engagement members (team, excluding the leader and Operations)' },
  { key: 'operations_members', label: 'Operations members on the team' },
  { key: 'supervisor', label: 'Supervisor' },
  { key: 'sector', label: 'Sector' },
  { key: 'scope', label: 'Scope' },
  { key: 'start_date', label: 'Start date' },
  { key: 'end_date', label: 'Planned end date (or “Not set”)' },
];

const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
export const isEmail = (s: string) => EMAIL_RE.test(s.trim());

/** Split pasted text (commas, semicolons, new lines) into clean, unique addresses. */
export function parseEmailList(text: string): { valid: string[]; invalid: string[] } {
  const parts = text.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
  const valid = [...new Set(parts.filter(isEmail).map((x) => x.toLowerCase()))];
  return { valid, invalid: parts.filter((x) => !isEmail(x)) };
}

export interface ProjectEmail {
  subject: string;
  body: string;
  /** The engagement's people who have an email address. */
  to: string[];
  /** The planning committee (minus anyone already in `to`). */
  cc: string[];
  /** People on the engagement with no email on file — they won't receive it. */
  missing: string[];
  fields: Record<string, string>;
}

const fill = (template: string, fields: Record<string, string>) =>
  template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, k: string) => (k in fields ? fields[k] : m));

export function buildProjectEmail(
  e: Pick<Engagement, 'name' | 'client' | 'sector' | 'scope' | 'start' | 'end' | 'leadId' | 'teamIds' | 'supervisorId'>,
  talentById: (id: string) => Pick<Talent, 'name' | 'department' | 'email'> | undefined,
  settings: NotificationSettings,
): ProjectEmail {
  const name = (id: string) => talentById(id)?.name ?? id;
  const team = e.teamIds.filter((id) => id !== e.leadId && id !== e.supervisorId);
  const ops = team.filter((id) => talentById(id)?.department === 'Operations');
  const members = team.filter((id) => talentById(id)?.department !== 'Operations');
  const list = (ids: string[]) => (ids.length ? ids.map(name).join(', ') : '—');
  const fields: Record<string, string> = {
    project_name: e.name,
    client_name: e.client,
    engagement_leader: name(e.leadId),
    engagement_members: list(members),
    operations_members: list(ops),
    supervisor: e.supervisorId ? name(e.supervisorId) : '—',
    sector: e.sector,
    scope: e.scope,
    start_date: e.start,
    end_date: e.end ?? 'Not set',
  };
  const people = [...new Set([e.leadId, ...e.teamIds, ...(e.supervisorId ? [e.supervisorId] : [])])];
  const to: string[] = [];
  const missing: string[] = [];
  for (const id of people) {
    const addr = talentById(id)?.email?.trim().toLowerCase();
    if (addr && isEmail(addr)) { if (!to.includes(addr)) to.push(addr); } else missing.push(name(id));
  }
  const cc = settings.committee.map((x) => x.toLowerCase()).filter((x) => !to.includes(x));
  return { subject: fill(settings.subject, fields), body: fill(settings.body, fields), to, cc, missing, fields };
}

/* One-click sending from the person's own mail app: links that open a ready-made email. */
const q = (params: Record<string, string>) =>
  Object.entries(params).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

/** Opens the default mail app (Outlook desktop, Apple Mail…). */
export function mailtoLink(m: Pick<ProjectEmail, 'to' | 'cc' | 'subject' | 'body'>): string {
  const to = m.to.length ? m.to : m.cc;
  const cc = m.to.length ? m.cc : [];
  return `mailto:${to.join(',')}?${q({ cc: cc.join(','), subject: m.subject, body: m.body.replace(/\r?\n/g, '\r\n') })}`;
}

/** Opens a new message in Outlook on the web (Microsoft 365). */
export function outlookWebLink(m: Pick<ProjectEmail, 'to' | 'cc' | 'subject' | 'body'>): string {
  const to = m.to.length ? m.to : m.cc;
  const cc = m.to.length ? m.cc : [];
  return `https://outlook.office.com/mail/deeplink/compose?${q({ to: to.join(','), cc: cc.join(','), subject: m.subject, body: m.body })}`;
}

/** Plain-text version for copying into any mail app. */
export function emailAsText(m: Pick<ProjectEmail, 'to' | 'cc' | 'subject' | 'body'>): string {
  return [`To: ${m.to.join('; ')}`, m.cc.length ? `Cc: ${m.cc.join('; ')}` : '', `Subject: ${m.subject}`, '', m.body].filter((l, i) => l || i > 2).join('\n');
}

/* Bulk email import: paste "Name, email" lines (or two columns copied from Excel). */
export interface EmailImportRow {
  name: string;
  email: string;
  talentId: string | null;
  current: string | null;
  /** fill = empty today; same = already this email; keep = has a different email (kept unless replacing);
      unmatched = no one on the roster with that name; invalid = no valid email on the line */
  status: 'fill' | 'same' | 'keep' | 'unmatched' | 'invalid';
}

const normName = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z]+/g, ' ').trim().replace(/\s+/g, ' ');

export function parseEmailImport(text: string, roster: { id: string; name: string; email: string | null }[]): EmailImportRow[] {
  const byName = new Map(roster.map((t) => [normName(t.name), t]));
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).flatMap((line): EmailImportRow[] => {
    const parts = line.split(/\t|,|;/).map((x) => x.trim()).filter(Boolean);
    const email = parts.find((p) => isEmail(p))?.toLowerCase() ?? '';
    const name = parts.filter((p) => !isEmail(p)).join(' ');
    if (!name && !email) return [];
    // Skip header rows such as "Name | Email" or "Full name, Business e-mail".
    if (!email && /^((full|employee|business|work)\s*)?(name|e-?\s*mail|email|address)(\s+((full|employee|business|work)\s*)?(name|e-?\s*mail|email|address))*$/i.test(name)) return [];
    const t = byName.get(normName(name));
    if (!email) return [{ name, email: '', talentId: t?.id ?? null, current: t?.email ?? null, status: 'invalid' }];
    if (!t) return [{ name, email, talentId: null, current: null, status: 'unmatched' }];
    const current = t.email?.toLowerCase() ?? null;
    return [{ name: t.name, email, talentId: t.id, current, status: !current ? 'fill' : current === email ? 'same' : 'keep' }];
  });
}
