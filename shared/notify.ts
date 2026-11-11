/* The "new project commissioned" email: template, fields and recipients.
   Shared so the web app can preview exactly what the server will send. */
import type { Engagement, NotificationSettings, Talent } from './types.js';

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: true,
  committee: [],
  sendFrom: null,
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
  /** The planning committee (minus anyone already in `to`, and minus the sending mailbox). */
  cc: string[];
  /** Mailbox to send from, when one is set (e.g. the planning mailbox). */
  from: string | null;
  /** People on the engagement with no email on file — they won't receive it. */
  missing: string[];
  fields: Record<string, string>;
}

/** Field names people naturally type, mapped to the template fields. Matching ignores case, spaces,
    hyphens and underscores, so {{Project Name}}, {{project-name}} and {{project_name}} all work. */
const FIELD_ALIASES: Record<string, string> = {
  project: 'project_name', projectname: 'project_name', engagement: 'project_name', engagementname: 'project_name', name: 'project_name',
  client: 'client_name', clientname: 'client_name',
  leader: 'engagement_leader', lead: 'engagement_leader', engagementleader: 'engagement_leader', engagementlead: 'engagement_leader',
  members: 'engagement_members', team: 'engagement_members', engagementmembers: 'engagement_members', teammembers: 'engagement_members',
  operations: 'operations_members', ops: 'operations_members', operationsmember: 'operations_members', operationsmembers: 'operations_members', operationsteam: 'operations_members',
  supervisor: 'supervisor', sector: 'sector', scope: 'scope',
  start: 'start_date', startdate: 'start_date', end: 'end_date', enddate: 'end_date', plannedend: 'end_date', plannedenddate: 'end_date',
};
export const fieldKey = (raw: string): string | null => {
  const k = raw.toLowerCase().replace(/[^a-z]/g, '');
  return FIELD_ALIASES[k] ?? null;
};
const PLACEHOLDER = /\{\{\s*([^{}]{1,40}?)\s*\}\}/g;

const fill = (template: string, fields: Record<string, string>) =>
  template.replace(PLACEHOLDER, (m, raw: string) => { const k = fieldKey(raw); return k && k in fields ? fields[k] : m; });

/** Placeholders in a template that don't match any field (shown as a warning in Settings). */
export function unknownPlaceholders(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER)].map((x) => x[0]).filter((m) => !fieldKey(m.slice(2, -2)));
}

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
  const from = settings.sendFrom?.trim().toLowerCase() || null;
  const cc = settings.committee.map((x) => x.toLowerCase()).filter((x) => !to.includes(x) && x !== from);
  return { subject: fill(settings.subject, fields), body: fill(settings.body, fields), to, cc, from, missing, fields };
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

/** Opens a new message in the Outlook app on iPhone / iPad / Android (community-documented
    ms-outlook:// scheme). The app composes from its default account. */
export function outlookAppLink(m: Pick<ProjectEmail, 'to' | 'cc' | 'subject' | 'body'>): string {
  const to = m.to.length ? m.to : m.cc;
  const cc = m.to.length ? m.cc : [];
  return `ms-outlook://compose?${q({ to: to.join(','), cc: cc.join(','), subject: m.subject, body: m.body })}`;
}

/** Opens a new message in Outlook on the web (Microsoft 365). With `from`, the message is composed
    inside that shared mailbox, so Outlook fills its address in the From field (the person needs
    permission to send from it). */
export function outlookWebLink(m: Pick<ProjectEmail, 'to' | 'cc' | 'subject' | 'body'> & { from?: string | null }): string {
  const to = m.to.length ? m.to : m.cc;
  const cc = m.to.length ? m.cc : [];
  const mailbox = m.from ? `${encodeURIComponent(m.from)}/` : '';
  return `https://outlook.office.com/mail/${mailbox}deeplink/compose?${q({ to: to.join(','), cc: cc.join(','), subject: m.subject, body: m.body })}`;
}

/** Plain-text version for copying into any mail app. */
export function emailAsText(m: Pick<ProjectEmail, 'to' | 'cc' | 'subject' | 'body'> & { from?: string | null }): string {
  return [...(m.from ? [`From: ${m.from}`] : []), `To: ${m.to.join('; ')}`, m.cc.length ? `Cc: ${m.cc.join('; ')}` : '', `Subject: ${m.subject}`, '', m.body].filter((l, i) => l || i > 2).join('\n');
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

/** A ready-to-send draft as an .eml file. `X-Unsent: 1` makes classic Outlook for Windows open it
    as a new, editable message (with From set when that account is in Outlook), not as received mail. */
export function emlFile(m: Pick<ProjectEmail, 'to' | 'cc' | 'subject' | 'body'> & { from?: string | null }): string {
  const to = m.to.length ? m.to : m.cc;
  const cc = m.to.length ? m.cc : [];
  const b64 = (s: string) => {
    const bytes = new TextEncoder().encode(s);
    let bin = '';
    bytes.forEach((b) => { bin += String.fromCharCode(b); });
    return btoa(bin);
  };
  const header = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
  const body = b64(m.body.replace(/\r?\n/g, '\r\n')).replace(/.{1,76}/g, '$&\r\n');
  return [
    'X-Unsent: 1',
    ...(m.from ? [`From: ${m.from}`] : []),
    `To: ${to.join(', ')}`,
    ...(cc.length ? [`Cc: ${cc.join(', ')}`] : []),
    `Subject: ${header(m.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="utf-8"',
    'Content-Transfer-Encoding: base64',
    '',
    body,
  ].join('\r\n');
}
