import fs from 'node:fs';
import { Router } from 'express';
import { z } from 'zod';
import { buildModel } from '../../shared/engine';
import { stageLabel, toCsv } from '../../shared/schedule';
import type { SeedFile } from '../../shared/types';
import { requireRole } from '../auth';
import { type DB, loadSeed } from '../db';
import { HttpError, auditPeople, broadcast, lastUndoable, listAudit, readWorkspace, subscribe, undo } from '../store';
import { me, parse, route } from './util';

export function workspaceRoutes(db: DB, opts: { demoSeedPath: string }): Router {
  const r = Router();
  const viewer = requireRole('viewer');

  r.get('/workspace', viewer, route(() => readWorkspace(db)));
  r.get('/events', viewer, (_req, res) => subscribe(res));

  // ---- audit trail & undo ----
  r.get('/audit', viewer, route((req) => ({
    entries: listAudit(db, { q: String(req.query.q ?? ''), user: String(req.query.user ?? ''), limit: Number(req.query.limit ?? 300) }),
    people: auditPeople(db),
    lastUndoable: req.user ? lastUndoable(db, req.user.id) : null,
  })));
  r.post('/audit/:id/undo', requireRole('editor'), route((req) => {
    undo(db, me(req), Number(req.params.id));
    return { ok: true };
  }));
  r.post('/audit/undo-last', requireRole('editor'), route((req) => {
    const id = lastUndoable(db, me(req).id);
    if (!id) throw new HttpError(409, 'Nothing of yours to undo.');
    undo(db, me(req), id);
    return { ok: true, undid: id };
  }));

  // ---- CSV exports (computed with the same engine as the UI) ----
  r.get('/export/:kind.csv', viewer, route((req, res) => {
    const m = buildModel(readWorkspace(db));
    let csv: string;
    switch (req.params.kind) {
      case 'engagements':
        csv = toCsv(m.engagements.map((e) => ({
          name: e.name, client: e.client, sector: e.sector, scope: e.scope, status: m.bucket(e), stage: stageLabel(e.stage),
          lead: m.name(e.leadId), team: e.teamIds.map((id) => m.name(id)).join('; '), supervisor: e.supervisorId ? m.name(e.supervisorId) : '',
          start: e.start, end: e.end, health: m.bucket(e) === 'active' ? m.health(e) : '', priority: m.bucket(e) === 'active' ? m.priority(e) : '',
          workload: e.workloadTier, price: e.price ?? '', cost: e.cost ?? '',
        })), ['name', 'client', 'sector', 'scope', 'status', 'stage', 'lead', 'team', 'supervisor', 'start', 'end', 'health', 'priority', 'workload', 'price', 'cost']);
        break;
      case 'talents':
        csv = toCsv(m.talents.map((t) => ({ name: t.name, title: t.title, department: t.department, utilization: t.util, status: t.utilStatus, engagements: t.engagementCount, capacity: t.projectCapacity, flagged: t.flag ? 'yes' : '' })),
          ['name', 'title', 'department', 'utilization', 'status', 'engagements', 'capacity', 'flagged']);
        break;
      case 'clients':
        csv = toCsv(m.clients(), ['name', 'industry', 'country', 'active', 'historical', 'owner']);
        break;
      case 'trajectory':
        csv = toCsv(m.data.trajectory, ['year', 'month', 'engagement', 'client', 'sector', 'scope', 'status', 'talent', 'title', 'role']);
        break;
      default:
        throw new HttpError(404, 'Unknown export.');
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="eeos-${req.params.kind}-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send('﻿' + csv);
    return undefined;
  }));

  // ---- full backup / restore (admins) ----
  r.get('/admin/backup', requireRole('admin'), route((_req, res) => {
    const w = readWorkspace(db);
    const seed: SeedFile = {
      generatedAt: new Date().toISOString(), description: 'EEOS backup',
      talents: w.talents, engagements: w.engagements, clients: w.clients, capacityRules: w.capacityRules,
      trajectory: w.trajectory.map(({ id: _id, ...rest }) => rest), // eslint-disable-line @typescript-eslint/no-unused-vars
    };
    res.setHeader('Content-Disposition', `attachment; filename="eeos-backup-${seed.generatedAt.slice(0, 10)}.json"`);
    return seed;
  }));

  const seedSchema = z.object({
    talents: z.array(z.any()), engagements: z.array(z.any()), clients: z.array(z.any()), capacityRules: z.array(z.any()), trajectory: z.array(z.any()),
  }).passthrough();
  r.post('/admin/restore', requireRole('admin'), route((req) => {
    const seed = parse(seedSchema, req.body) as unknown as SeedFile;
    seed.description ??= 'Restored backup';
    loadSeed(db, seed);
    broadcast({ type: 'changed', by: me(req).name });
    return { ok: true };
  }));
  r.post('/admin/reset-demo', requireRole('admin'), route((req) => {
    loadSeed(db, JSON.parse(fs.readFileSync(opts.demoSeedPath, 'utf8')));
    broadcast({ type: 'changed', by: me(req).name });
    return { ok: true };
  }));

  return r;
}
