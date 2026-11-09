import { DEFAULT_NOTIFICATION_SETTINGS, buildProjectEmail, type ProjectEmail } from '../shared/notify.js';
import type { Engagement, NotificationSettings, Talent, User } from '../shared/types.js';
import { type DB, all, getEntity, getMeta, run, setMeta, talentFromRow } from './db.js';
import type { Mailer } from './mailer.js';

const KEY = 'notificationSettings';

export async function getNotificationSettings(db: DB): Promise<NotificationSettings> {
  const raw = await getMeta(db, KEY);
  return raw ? { ...DEFAULT_NOTIFICATION_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_NOTIFICATION_SETTINGS };
}
export async function saveNotificationSettings(db: DB, s: NotificationSettings): Promise<void> {
  await setMeta(db, KEY, JSON.stringify(s));
}

export interface SendResult {
  sent: boolean;
  /** Why nothing was sent (not an error): disabled, or no recipients. */
  skipped?: string;
  error?: string;
  to: string[];
  cc: string[];
  missing: string[];
}

export async function composeProjectEmail(db: DB, engagementId: string): Promise<ProjectEmail> {
  const e = (await getEntity(db, 'engagement', engagementId)) as Engagement | null;
  if (!e) throw new Error('Engagement not found.');
  const talents = new Map((await all(db, 'SELECT * FROM talents')).map((r) => { const t = talentFromRow(r); return [t.id, t] as [string, Talent]; }));
  return buildProjectEmail(e, (id) => talents.get(id), await getNotificationSettings(db));
}

/** Email the engagement's people and the planning committee. Never throws: the result says what happened,
    and every attempt is written to the audit trail. */
export async function sendProjectEmail(db: DB, mailer: Mailer, engagementId: string, user: User, opts: { force?: boolean } = {}): Promise<SendResult> {
  const settings = await getNotificationSettings(db);
  let mail: ProjectEmail;
  try {
    mail = await composeProjectEmail(db, engagementId);
  } catch (e) {
    return { sent: false, error: (e as Error).message, to: [], cc: [], missing: [] };
  }
  const base = { to: mail.to, cc: mail.cc, missing: mail.missing };
  if (!settings.enabled && !opts.force) return { ...base, sent: false, skipped: 'New-project emails are turned off in Settings.' };
  if (!mail.to.length && !mail.cc.length) return { ...base, sent: false, skipped: 'Nobody on this engagement has an email address yet, and no planning committee is set.' };
  let result: SendResult;
  try {
    await mailer.send({ to: mail.to.length ? mail.to : mail.cc, cc: mail.to.length ? mail.cc : [], subject: mail.subject, text: mail.body, replyTo: user.email });
    result = { ...base, sent: true };
  } catch (e) {
    result = { ...base, sent: false, error: (e as Error).message };
  }
  const recipients = [...mail.to, ...mail.cc].length;
  await run(db, 'INSERT INTO audit_log (at,user_id,user_name,action,entity_type,entity_id,entity_name,details) VALUES (?,?,?,?,?,?,?,?)', [
    new Date().toISOString(), user.id, user.name, result.sent ? 'Sent new-project email' : 'New-project email failed', 'email', engagementId, mail.fields.project_name,
    result.sent ? `${recipients} recipient(s)${mail.missing.length ? ` · no email on file for ${mail.missing.join(', ')}` : ''}` : result.error ?? '',
  ]);
  return result;
}
