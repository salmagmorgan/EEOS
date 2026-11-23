/* Engagement updates meeting: session notes (where we are, challenges, next steps, who does what),
   comments on them, and each engagement's key milestones. Every change is audited and undoable. */
import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import type { Engagement, MeetingNote, Milestone, User } from '../../shared/types.js';
import { requireRole } from '../auth.js';
import { type DB, getEntity } from '../db.js';
import { HttpError, mutate } from '../store.js';
import { me, parse, route } from './util.js';

const newId = (prefix: string) => prefix + crypto.randomBytes(6).toString('hex');
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date (YYYY-MM-DD)');
const text = (max: number) => z.string().max(max).transform((s) => s.trim());

const actionInput = z.object({
  id: z.string().max(40).optional(),
  task: z.string().trim().min(1, 'is required').max(500),
  ownerId: z.string().max(60).nullable().optional(),
  due: day.nullable().optional().or(z.literal('').transform(() => null)),
  done: z.boolean().optional(),
});
const noteInput = z.object({
  date: day,
  rag: z.enum(['on-track', 'at-risk', 'off-track']),
  progress: z.number().min(0).max(100).nullable().optional(),
  notes: text(10000).default(''),
  whereWeAre: text(5000).default(''),
  challenges: text(5000).default(''),
  nextSteps: text(5000).default(''),
  actions: z.array(actionInput).max(60).default([]),
});
const milestoneInput = z.object({
  title: z.string().trim().min(1, 'is required').max(200),
  date: day.nullable().optional().or(z.literal('').transform(() => null)),
  status: z.enum(['planned', 'in-progress', 'done', 'delayed']).default('planned'),
});

export function meetingRoutes(db: DB): Router {
  const r = Router();
  const editor = requireRole('editor');

  const engagement = async (id: string) => {
    const e = (await getEntity(db, 'engagement', id)) as Engagement | null;
    if (!e || e.status === 'deleted') throw new HttpError(404, 'Engagement not found.');
    return e;
  };
  const note = async (id: string) => {
    const n = (await getEntity(db, 'meetingNote', id)) as MeetingNote | null;
    if (!n) throw new HttpError(404, 'Meeting notes not found.');
    return n;
  };
  const milestone = async (id: string) => {
    const m = (await getEntity(db, 'milestone', id)) as Milestone | null;
    if (!m) throw new HttpError(404, 'Milestone not found.');
    return m;
  };
  const cleanActions = (list: z.infer<typeof actionInput>[]) =>
    list.map((a) => ({ id: a.id || newId('act_'), task: a.task, ownerId: a.ownerId || null, due: a.due ?? null, done: !!a.done }));
  const saveNote = (user: User, e: Engagement, id: string, action: string, apply: (n: MeetingNote | null) => MeetingNote | null, details = '') =>
    mutate<MeetingNote>(db, user, { type: 'meetingNote', id, action, apply, entityName: e.name, details: (_b, a) => details || (a ? `Session of ${a.date}` : '') });

  // ---- session notes ----
  r.post('/engagements/:id/meeting-notes', editor, route(async (req) => {
    const user = me(req);
    const e = await engagement(req.params.id);
    const body = parse(noteInput, req.body);
    const id = newId('mtg_');
    const now = new Date().toISOString();
    return {
      note: await saveNote(user, e, id, 'Added meeting notes', () => ({
        id, engagementId: e.id, date: body.date, rag: body.rag, progress: body.progress ?? null,
        notes: body.notes, whereWeAre: body.whereWeAre, challenges: body.challenges, nextSteps: body.nextSteps,
        actions: cleanActions(body.actions), comments: [], createdBy: user.name, createdAt: now, updatedAt: now,
      })),
    };
  }));

  r.patch('/meeting-notes/:id', editor, route(async (req) => {
    const n = await note(req.params.id);
    const e = await engagement(n.engagementId);
    const body = parse(noteInput.partial(), req.body);
    return {
      note: await saveNote(me(req), e, n.id, 'Edited meeting notes', (x) => ({
        ...x!, editedAt: new Date().toISOString(), editedBy: me(req).name,
        ...Object.fromEntries(Object.entries(body).filter(([k, v]) => v !== undefined && k !== 'actions')),
        ...(body.actions ? { actions: cleanActions(body.actions) } : {}),
      }) as MeetingNote),
    };
  }));

  r.delete('/meeting-notes/:id', editor, route(async (req) => {
    const n = await note(req.params.id);
    const e = await engagement(n.engagementId);
    await saveNote(me(req), e, n.id, 'Deleted meeting notes', () => null, `Session of ${n.date}`);
    return { ok: true };
  }));

  /** Tick an action item done / not done. */
  r.put('/meeting-notes/:id/actions/:actionId', editor, route(async (req) => {
    const { done } = parse(z.object({ done: z.boolean() }), req.body);
    const n = await note(req.params.id);
    const a = n.actions.find((x) => x.id === req.params.actionId);
    if (!a) throw new HttpError(404, 'Action not found.');
    const e = await engagement(n.engagementId);
    return {
      note: await saveNote(me(req), e, n.id, done ? 'Completed action' : 'Reopened action', (x) => {
        x!.actions.find((y) => y.id === a.id)!.done = done;
        return x;
      }, a.task),
    };
  }));

  // ---- comments ----
  r.post('/meeting-notes/:id/comments', editor, route(async (req) => {
    const { text: body } = parse(z.object({ text: z.string().trim().min(1, 'is required').max(2000) }), req.body);
    const user = me(req);
    const n = await note(req.params.id);
    const e = await engagement(n.engagementId);
    return {
      note: await saveNote(user, e, n.id, 'Commented on meeting notes', (x) => {
        x!.comments.push({ id: newId('cmt_'), by: user.name, at: new Date().toISOString(), text: body });
        return x;
      }, body.length > 80 ? body.slice(0, 80) + '…' : body),
    };
  }));
  r.delete('/meeting-notes/:id/comments/:commentId', editor, route(async (req) => {
    const n = await note(req.params.id);
    const c = n.comments.find((x) => x.id === req.params.commentId);
    if (!c) throw new HttpError(404, 'Comment not found.');
    const e = await engagement(n.engagementId);
    return { note: await saveNote(me(req), e, n.id, 'Deleted comment', (x) => ({ ...x!, comments: x!.comments.filter((y) => y.id !== c.id) }), c.text.slice(0, 80)) };
  }));

  // ---- milestones ----
  r.post('/engagements/:id/milestones', editor, route(async (req) => {
    const e = await engagement(req.params.id);
    const body = parse(milestoneInput, req.body);
    const id = newId('ms_');
    const now = new Date().toISOString();
    return {
      milestone: await mutate<Milestone>(db, me(req), {
        type: 'milestone', id, action: 'Added milestone', entityName: e.name,
        apply: () => ({ id, engagementId: e.id, title: body.title, date: body.date ?? null, status: body.status, createdAt: now, updatedAt: now }),
        details: (_b, a) => `${a!.title}${a!.date ? ' · ' + a!.date : ''}`,
      }),
    };
  }));
  r.patch('/milestones/:id', editor, route(async (req) => {
    const m = await milestone(req.params.id);
    const e = await engagement(m.engagementId);
    const body = parse(milestoneInput.partial(), req.body);
    return {
      milestone: await mutate<Milestone>(db, me(req), {
        type: 'milestone', id: m.id, action: 'Updated milestone', entityName: e.name,
        apply: (x) => ({ ...x!, ...Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)) }) as Milestone,
        details: (b, a) => `${a!.title}${b!.status !== a!.status ? ` · ${b!.status} → ${a!.status}` : ''}`,
      }),
    };
  }));
  r.delete('/milestones/:id', editor, route(async (req) => {
    const m = await milestone(req.params.id);
    const e = await engagement(m.engagementId);
    await mutate<Milestone>(db, me(req), { type: 'milestone', id: m.id, action: 'Deleted milestone', entityName: e.name, apply: () => null, details: () => m.title });
    return { ok: true };
  }));

  return r;
}
