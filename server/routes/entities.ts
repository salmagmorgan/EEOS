import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { DEPARTMENTS, SCOPES, SCOPE_STAGES, STAGE_IDS, TITLES, WORKLOAD_TIER_NAMES, type StageId } from '../../shared/constants';
import { initialsOf } from '../../shared/engine';
import { addDays, parseDay, scopeStages, stageLabel, toDay } from '../../shared/schedule';
import type { CapacityRule, Client, Engagement, Talent, User } from '../../shared/types';
import { requireRole } from '../auth';
import { type DB, getEntity } from '../db';
import { HttpError, mutate } from '../store';
import { me, parse, route } from './util';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD');
const money = z.number().finite().min(0).nullable();
const cpsSchema = z.array(z.object({
  id: z.enum(STAGE_IDS as [StageId, ...StageId[]]), label: z.string(), start: day, end: day,
  startWeek: z.number().int().optional(), endWeek: z.number().int().optional(), owner: z.string().nullable().optional(),
})).nullable();

const newId = (prefix: string) => prefix + crypto.randomBytes(6).toString('hex');
const fmt = (n: number | null) => (n === null ? '—' : n.toLocaleString('en-US'));

export function entityRoutes(db: DB): Router {
  const r = Router();
  const editor = requireRole('editor');

  // ---------- helpers ----------
  const talent = (id: string) => getEntity(db, 'talent', id) as Talent | null;
  const activeTalent = (id: string, label: string) => {
    const t = talent(id);
    if (!t || t.status !== 'active') throw new HttpError(400, `${label} must be someone on the active roster.`);
    return t;
  };
  const loadEngagement = (id: string, opts: { allowHistorical?: boolean } = {}) => {
    const e = getEntity(db, 'engagement', id) as Engagement | null;
    if (!e) throw new HttpError(404, 'Engagement not found.');
    if (e.historical && !opts.allowHistorical) throw new HttpError(409, 'Historical records are read-only.');
    return e;
  };
  const names = (ids: string[]) => ids.map((id) => talent(id)?.name ?? id).join(', ');

  /** Normalise lead / team / supervisor: the supervisor is never also a team member, and a team is never empty. */
  function normaliseTeam(leadId: string, teamIds: string[], supervisorId: string | null) {
    activeTalent(leadId, 'The lead');
    if (supervisorId) {
      const s = activeTalent(supervisorId, 'The supervisor');
      if (s.department === 'Operations') throw new HttpError(400, 'Supervisors come from Consulting or Pulse.');
      if (supervisorId === leadId) throw new HttpError(400, 'The lead cannot also be the supervisor.');
    }
    const team = [...new Set(teamIds)].filter((id) => id !== supervisorId);
    team.forEach((id) => activeTalent(id, 'Every team member'));
    return { leadId, teamIds: team.length ? team : [leadId], supervisorId };
  }

  function ensureClient(user: User, name: string, sector: string, country: string, ownerName: string) {
    const exists = db.prepare('SELECT id FROM clients WHERE name=?').get(name);
    if (exists) return;
    const id = newId('c_');
    mutate<Client>(db, user, { type: 'client', id, action: 'Added client', apply: () => ({ id, name, industry: sector, country, owner: ownerName }) });
  }

  const engagementMutation = (id: string, action: string, apply: (e: Engagement) => void, details?: (e: Engagement) => string, opts: { allowHistorical?: boolean } = {}) =>
    (user: User) => {
      loadEngagement(id, opts);
      return mutate<Engagement>(db, user, {
        type: 'engagement', id, action,
        apply: (e) => { apply(e!); return e; },
        details: (_b, a) => (details && a ? details(a) : ''),
      });
    };

  // ---------- engagements ----------
  const engagementInput = z.object({
    name: z.string().trim().min(1, 'is required').max(160),
    client: z.string().trim().min(1, 'is required').max(120),
    country: z.string().trim().max(60).default('Egypt'),
    sector: z.string().trim().min(1, 'is required').max(60),
    scope: z.enum(SCOPES),
    subScope: z.string().trim().max(80).nullable().default(null),
    stage: z.enum(STAGE_IDS as [StageId, ...StageId[]]).optional(),
    leadId: z.string(),
    teamIds: z.array(z.string()).default([]),
    supervisorId: z.string().nullable().default(null),
    start: day.optional(),
    end: day.optional(),
    notes: z.string().max(5000).default(''),
    workloadTier: z.enum(WORKLOAD_TIER_NAMES as [string, ...string[]]).default('Quick Work'),
    price: money.default(null),
    cost: money.default(null),
    customCps: cpsSchema.default(null),
  });

  r.post('/engagements', editor, route((req) => {
    const user = me(req);
    const body = parse(engagementInput, req.body);
    const team = normaliseTeam(body.leadId, body.teamIds, body.supervisorId);
    const start = body.start ?? toDay(new Date());
    const end = body.end ?? toDay(addDays(parseDay(start), SCOPE_STAGES[body.scope].typicalDays));
    if (parseDay(end) <= parseDay(start)) throw new HttpError(400, 'The end date must be after the start date.');
    const stages = scopeStages(body.scope);
    const stage = body.stage && stages.some((s) => s.id === body.stage) ? body.stage : stages[0].id;
    const hasSub = body.scope === 'Strategy' || body.scope === 'Research and Strategy';
    const now = new Date().toISOString();
    ensureClient(user, body.client, body.sector, body.country, talent(team.leadId)!.name);
    const id = newId('eng_');
    const created = mutate<Engagement>(db, user, {
      type: 'engagement', id, action: 'Created engagement',
      apply: () => ({
        id, name: body.name, client: body.client, country: body.country || 'Egypt', sector: body.sector, scope: body.scope,
        subScope: hasSub ? body.subScope || null : null, stage, ...team, start, end, notes: body.notes,
        workloadTier: body.workloadTier as Engagement['workloadTier'], customCps: body.customCps, price: body.price, cost: body.cost,
        status: 'active', historical: false, allocationOverrides: {}, createdAt: now, updatedAt: now,
      }),
      details: (_b, a) => `${a!.client} · ${a!.scope} · Lead: ${names([a!.leadId])}${a!.supervisorId ? ' · Supervisor: ' + names([a!.supervisorId]) : ''}`,
    });
    return { engagement: created };
  }));

  r.patch('/engagements/:id', editor, route((req) => {
    const body = parse(engagementInput.pick({ name: true, client: true, country: true, sector: true, scope: true, subScope: true, start: true, end: true, notes: true }).partial(), req.body);
    const user = me(req);
    const current = loadEngagement(req.params.id);
    const start = body.start ?? current.start;
    const end = body.end ?? current.end;
    if (parseDay(end) <= parseDay(start)) throw new HttpError(400, 'The end date must be after the start date.');
    if (body.client && body.client !== current.client) ensureClient(user, body.client, body.sector ?? current.sector, body.country ?? current.country, talent(current.leadId)?.name ?? 'Unassigned');
    return {
      engagement: engagementMutation(req.params.id, 'Edited engagement details', (e) => {
        Object.assign(e, Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)));
        if (body.scope && body.scope !== current.scope) {
          const stages = scopeStages(e.scope);
          if (!stages.some((s) => s.id === e.stage)) e.stage = stages[0].id;
          e.customCps = null;
        }
        if (e.scope !== 'Strategy' && e.scope !== 'Research and Strategy') e.subScope = null;
      }, (e) => Object.keys(body).filter((k) => (body as Record<string, unknown>)[k] !== undefined).map((k) => `${k}: ${String((e as unknown as Record<string, unknown>)[k] ?? '—')}`).join(' · '))(user),
    };
  }));

  r.put('/engagements/:id/team', editor, route((req) => {
    const body = parse(z.object({ leadId: z.string(), teamIds: z.array(z.string()), supervisorId: z.string().nullable() }), req.body);
    const team = normaliseTeam(body.leadId, body.teamIds, body.supervisorId);
    return {
      engagement: engagementMutation(req.params.id, 'Updated team', (e) => {
        Object.assign(e, team);
        // Drop allocation overrides for people no longer on the engagement.
        const members = new Set([e.leadId, ...e.teamIds, ...(e.supervisorId ? [e.supervisorId] : [])]);
        e.allocationOverrides = Object.fromEntries(Object.entries(e.allocationOverrides).filter(([k]) => members.has(k)));
      }, (e) => `Lead: ${names([e.leadId])} · ${e.teamIds.length} member(s)${e.supervisorId ? ' · Supervisor: ' + names([e.supervisorId]) : ''}`)(me(req)),
    };
  }));

  r.put('/engagements/:id/stage', editor, route((req) => {
    const body = parse(z.object({ stage: z.enum(STAGE_IDS as [StageId, ...StageId[]]) }), req.body);
    const e = loadEngagement(req.params.id);
    if (e.status !== 'active') throw new HttpError(409, 'Only active engagements can change stage.');
    return { engagement: engagementMutation(req.params.id, 'Set stage', (x) => { x.stage = body.stage; }, (x) => 'to ' + stageLabel(x.stage))(me(req)) };
  }));

  r.post('/engagements/:id/advance', editor, route((req) => {
    const e = loadEngagement(req.params.id);
    if (e.status !== 'active') throw new HttpError(409, 'Only active engagements can advance.');
    const stages = scopeStages(e.scope);
    const idx = stages.findIndex((s) => s.id === e.stage);
    if (idx >= stages.length - 1) throw new HttpError(409, `${e.name} is already at its final stage.`);
    const next = stages[idx + 1];
    return { engagement: engagementMutation(req.params.id, 'Advanced stage', (x) => { x.stage = next.id; }, () => 'to ' + next.label)(me(req)) };
  }));

  const ACTIONS = {
    pause: { from: ['active'], to: 'paused', label: 'Paused engagement' },
    resume: { from: ['paused'], to: 'active', label: 'Resumed engagement' },
    close: { from: ['active', 'paused'], to: 'closed', label: 'Closed engagement' },
    reopen: { from: ['closed'], to: 'active', label: 'Reopened engagement' },
    delete: { from: ['active', 'paused', 'closed'], to: 'deleted', label: 'Deleted engagement' },
    restore: { from: ['deleted'], to: 'active', label: 'Restored deleted engagement' },
  } as const;
  r.post('/engagements/:id/:action(pause|resume|close|reopen|delete|restore)', editor, route((req) => {
    const a = ACTIONS[req.params.action as keyof typeof ACTIONS];
    const e = loadEngagement(req.params.id);
    if (!(a.from as readonly string[]).includes(e.status)) throw new HttpError(409, `Can't ${req.params.action} an engagement that is ${e.status}.`);
    return { engagement: engagementMutation(req.params.id, a.label, (x) => { x.status = a.to; })(me(req)) };
  }));

  r.put('/engagements/:id/financials', editor, route((req) => {
    const body = parse(z.object({ price: money, cost: money }), req.body);
    return {
      engagement: engagementMutation(req.params.id, 'Updated profitability', (e) => { e.price = body.price; e.cost = body.cost; },
        (e) => `Price ${fmt(e.price)} · Cost ${fmt(e.cost)}`, { allowHistorical: true })(me(req)),
    };
  }));

  r.put('/engagements/:id/workload', editor, route((req) => {
    const body = parse(z.object({ tier: z.enum(WORKLOAD_TIER_NAMES as [string, ...string[]]) }), req.body);
    return { engagement: engagementMutation(req.params.id, 'Set workload tier', (e) => { e.workloadTier = body.tier as Engagement['workloadTier']; }, (e) => 'to ' + e.workloadTier)(me(req)) };
  }));

  r.put('/engagements/:id/cps', editor, route((req) => {
    const body = parse(z.object({ stages: cpsSchema }), req.body);
    return {
      engagement: engagementMutation(req.params.id, body.stages ? 'Uploaded CPS schedule' : 'Cleared custom CPS schedule',
        (e) => { e.customCps = body.stages && body.stages.length ? body.stages : null; },
        (e) => (e.customCps ? `${e.customCps.length} stages` : 'Back to auto-projected schedule'))(me(req)),
    };
  }));

  r.put('/engagements/:id/allocations/:talentId', editor, route((req) => {
    const body = parse(z.object({ pct: z.number().min(0).max(100).nullable() }), req.body);
    const e = loadEngagement(req.params.id);
    const tid = req.params.talentId;
    if (![e.leadId, ...e.teamIds, e.supervisorId].includes(tid)) throw new HttpError(400, 'That person is not on this engagement.');
    return {
      engagement: engagementMutation(req.params.id, body.pct === null ? 'Cleared allocation override' : 'Overrode allocation', (x) => {
        if (body.pct === null) delete x.allocationOverrides[tid];
        else x.allocationOverrides[tid] = Math.round(body.pct);
      }, () => `${names([tid])} → ${body.pct === null ? 'tier default' : body.pct + '%'}`)(me(req)),
    };
  }));

  // ---------- talents ----------
  const talentInput = z.object({
    name: z.string().trim().min(2).max(80),
    title: z.string().refine((t) => TITLES.includes(t), 'unknown title'),
    department: z.string().refine((d) => DEPARTMENTS.includes(d), 'unknown department'),
  });
  const talentMutation = (user: User, id: string, action: string, apply: (t: Talent) => void, details?: (t: Talent) => string) => {
    if (!talent(id)) throw new HttpError(404, 'Talent not found.');
    return mutate<Talent>(db, user, { type: 'talent', id, action, apply: (t) => { apply(t!); return t; }, details: (_b, a) => (details && a ? details(a) : '') });
  };

  r.post('/talents', editor, route((req) => {
    const body = parse(talentInput, req.body);
    const id = newId('tal_');
    const now = new Date().toISOString();
    return {
      talent: mutate<Talent>(db, me(req), {
        type: 'talent', id, action: 'Added new talent',
        apply: () => ({ id, ...body, initials: initialsOf(body.name), status: 'active', utilOverride: null, flag: null, createdAt: now, updatedAt: now }),
        details: (_b, a) => `${a!.title} · ${a!.department}`,
      }),
    };
  }));

  r.patch('/talents/:id', editor, route((req) => {
    const body = parse(talentInput.partial(), req.body);
    return {
      talent: talentMutation(me(req), req.params.id, 'Edited talent record', (t) => {
        Object.assign(t, Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)));
        t.initials = initialsOf(t.name);
      }, (t) => `${t.title} · ${t.department}`),
    };
  }));

  r.post('/talents/:id/:action(remove|restore)', editor, route((req) => {
    const remove = req.params.action === 'remove';
    const t = talent(req.params.id);
    if (!t) throw new HttpError(404, 'Talent not found.');
    if (t.status === 'alumni') throw new HttpError(409, 'Alumni records are history only.');
    return { talent: talentMutation(me(req), req.params.id, remove ? 'Removed talent from roster' : 'Restored talent to roster', (x) => { x.status = remove ? 'removed' : 'active'; }) };
  }));

  r.put('/talents/:id/utilization-override', editor, route((req) => {
    const body = parse(z.object({ value: z.number().min(0).max(200).nullable(), reason: z.string().max(300).default('') }), req.body);
    const user = me(req);
    return {
      talent: talentMutation(user, req.params.id, body.value === null ? 'Cleared utilization override' : 'Overrode utilization', (t) => {
        t.utilOverride = body.value === null ? null : { value: Math.round(body.value), reason: body.reason, by: user.name, at: new Date().toISOString() };
      }, (t) => (t.utilOverride ? `to ${t.utilOverride.value}%${t.utilOverride.reason ? ' — ' + t.utilOverride.reason : ''}` : '')),
    };
  }));

  r.put('/talents/:id/flag', editor, route((req) => {
    const body = parse(z.object({ flagged: z.boolean() }), req.body);
    const user = me(req);
    return {
      talent: talentMutation(user, req.params.id, body.flagged ? 'Flagged for reallocation' : 'Removed reallocation flag', (t) => {
        t.flag = body.flagged ? { by: user.name, at: new Date().toISOString() } : null;
      }),
    };
  }));

  // ---------- capacity rules ----------
  r.put('/capacity-rules', editor, route((req) => {
    const body = parse(z.object({ title: z.string().min(1), department: z.string().min(1), project: z.number().int().min(0).max(20), leadership: z.number().int().min(0).max(20) }), req.body);
    const id = body.title + '__' + body.department;
    return {
      rule: mutate<CapacityRule>(db, me(req), {
        type: 'capacityRule', id, action: 'Updated capacity rule',
        apply: () => ({ ...body, placeholder: false }),
        details: (b, a) => `Project ${b?.project ?? '—'}→${a!.project} · Leadership ${b?.leadership ?? '—'}→${a!.leadership}`,
      }),
    };
  }));

  // ---------- clients ----------
  r.patch('/clients/:id', editor, route((req) => {
    const body = parse(z.object({ owner: z.string().trim().min(1).max(80), industry: z.string().trim().max(60), country: z.string().trim().max(60) }).partial(), req.body);
    if (!getEntity(db, 'client', req.params.id)) throw new HttpError(404, 'Client not found.');
    return {
      client: mutate<Client>(db, me(req), {
        type: 'client', id: req.params.id, action: 'Edited client',
        apply: (c) => ({ ...c!, ...Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)) }),
        details: (_b, a) => `Owner: ${a!.owner} · ${a!.industry}`,
      }),
    };
  }));

  return r;
}
