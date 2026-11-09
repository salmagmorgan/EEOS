import { Router } from 'express';
import { z } from 'zod';
import { DEFAULT_NOTIFICATION_SETTINGS, isEmail } from '../../shared/notify.js';
import { requireRole } from '../auth.js';
import { type DB, run } from '../db.js';
import type { Mailer } from '../mailer.js';
import { composeProjectEmail, getNotificationSettings, saveNotificationSettings, sendProjectEmail } from '../notifications.js';
import { HttpError } from '../store.js';
import { me, parse, route } from './util.js';

export function notificationRoutes(db: DB, mailer: Mailer): Router {
  const r = Router();

  r.get('/settings/notifications', requireRole('editor'), route(async () => ({
    settings: await getNotificationSettings(db),
    defaults: DEFAULT_NOTIFICATION_SETTINGS,
    sender: mailer.from,
  })));

  r.put('/settings/notifications', requireRole('admin'), route(async (req) => {
    const body = parse(z.object({
      enabled: z.boolean(),
      committee: z.array(z.string().trim().refine(isEmail, 'contains an invalid email address')).max(50),
      subject: z.string().trim().min(1).max(200),
      body: z.string().trim().min(1).max(5000),
    }), req.body);
    await saveNotificationSettings(db, { ...body, committee: [...new Set(body.committee.map((x) => x.toLowerCase()))] });
    return { settings: await getNotificationSettings(db) };
  }));

  /** Send a sample to the signed-in admin, using a real engagement's details when one is given. */
  r.post('/settings/notifications/test', requireRole('admin'), route(async (req) => {
    const user = me(req);
    const { engagementId } = parse(z.object({ engagementId: z.string().optional() }), req.body);
    const settings = await getNotificationSettings(db);
    const sample = engagementId ? await composeProjectEmail(db, engagementId) : null;
    const subject = '[TEST] ' + (sample?.subject ?? settings.subject);
    const text = (sample ? `This is a test. The real email would go to: ${[...sample.to, ...sample.cc].join(', ') || 'nobody yet'}\n\n` : 'This is a test of the EEOS email setup.\n\n') + (sample?.body ?? settings.body);
    try {
      await mailer.send({ to: [user.email], subject, text });
    } catch (e) {
      throw new HttpError(502, 'Sending failed: ' + (e as Error).message);
    }
    return { ok: true, to: user.email };
  }));

  /** Preview, or (re)send, the new-project email for an engagement. */
  r.get('/engagements/:id/notify', requireRole('viewer'), route(async (req) => ({ email: await composeProjectEmail(db, req.params.id), sender: mailer.from })));
  r.post('/engagements/:id/notify', requireRole('editor'), route(async (req) => ({ result: await sendProjectEmail(db, mailer, req.params.id, me(req), { force: true }) })));

  /** Record that someone opened the ready-made email in their own mail app (one-click mode). */
  r.post('/engagements/:id/notify/opened', requireRole('editor'), route(async (req) => {
    const { app } = parse(z.object({ app: z.enum(['outlook-web', 'mail-app', 'copied']) }), req.body);
    const mail = await composeProjectEmail(db, req.params.id);
    const user = me(req);
    const how = { 'outlook-web': 'Outlook on the web', 'mail-app': 'their mail app', copied: 'copied to clipboard' }[app];
    await run(db, 'INSERT INTO audit_log (at,user_id,user_name,action,entity_type,entity_id,entity_name,details) VALUES (?,?,?,?,?,?,?,?)', [
      new Date().toISOString(), user.id, user.name, 'Opened new-project email to send', 'email', req.params.id, mail.fields.project_name,
      `${how} · ${mail.to.length + mail.cc.length} recipient(s)`,
    ]);
    return { ok: true };
  }));

  return r;
}
