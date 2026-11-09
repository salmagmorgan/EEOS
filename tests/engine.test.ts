import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildModel, utilStatusFor } from '../shared/engine';
import { computeCps, health, parseCpsCsv, priority, progressFor } from '../shared/schedule';
import type { Engagement, SeedFile, WorkspaceData } from '../shared/types';

const seed: SeedFile = JSON.parse(fs.readFileSync('server/seed/demo-seed.json', 'utf8'));
const data: WorkspaceData = { version: 1, updatedAt: null, updatedBy: null, ...seed, trajectory: seed.trajectory.map((r, i) => ({ ...r, id: i + 1 })) };
const NOW = new Date('2026-11-09T12:00:00Z');

const eng = (over: Partial<Engagement>): Engagement => ({
  id: 'x', name: 'X', client: 'C', country: 'Egypt', sector: 'Retail', scope: 'Research', subScope: null, stage: 'kickoff',
  leadId: 't1', teamIds: ['t1', 't2'], supervisorId: null, start: '2026-11-01', end: '2027-02-01', notes: '', workloadTier: 'Quick Work',
  customCps: null, price: null, cost: null, status: 'active', historical: false, allocationOverrides: {}, createdAt: '', updatedAt: '', ...over,
});

describe('schedule', () => {
  it('splits a research engagement across its five stages, end to end', () => {
    const cps = computeCps('2026-01-01', '2026-04-01', 'Research');
    expect(cps.map((s) => s.id)).toEqual(['kickoff', 'situational', 'fieldwork', 'analysis', 'reportdev']);
    expect(cps[0].start.toISOString().slice(0, 10)).toBe('2026-01-01');
    expect(cps[4].end.toISOString().slice(0, 10)).toBe('2026-04-01');
  });
  it('computes progress within the scope', () => {
    expect(progressFor('Execution', 'deployment')).toBe(67);
    expect(progressFor('Research', 'reportdev')).toBe(100);
  });
  it('derives health and priority from dates, stage and staffing', () => {
    expect(health(eng({}), NOW)).toBe('Just Opened');
    expect(health(eng({ end: '2026-11-05' }), NOW)).toBe('Delayed');
    expect(health(eng({ stage: 'reportdev' }), NOW)).toBe('Complete');
    expect(health(eng({ start: '2026-08-01', end: '2026-11-20' }), NOW)).toBe('About to Close');
    expect(priority(eng({ teamIds: ['t1'] }), NOW)).toBe('High');
    expect(priority(eng({}), NOW)).toBe('Low');
  });
  it('parses a weekly CPS upload and reports unknown activities', () => {
    const csv = 'Activity,Start Week,End Week,Owner\nProject kickoff,1,2,Amira\n"Situational Analysis",3,6\nMystery,1,2';
    const { parsed, unmatched } = parseCpsCsv(csv, 'Research', '2026-01-05');
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ id: 'kickoff', start: '2026-01-05', end: '2026-01-19', owner: 'Amira' });
    expect(unmatched).toEqual(['Mystery']);
  });
});

describe('model', () => {
  const m = buildModel(data, NOW);
  it('classifies utilization bands', () => {
    expect(utilStatusFor(0, false)).toBe('Not Allocated');
    expect(utilStatusFor(60, true)).toBe('Underutilized');
    expect(utilStatusFor(80, true)).toBe('Optimal');
    expect(utilStatusFor(95, true)).toBe('At Capacity');
    expect(utilStatusFor(101, true)).toBe('Overutilized');
  });
  it('computes utilization as the sum of allocations across active engagements', () => {
    for (const t of m.talents) {
      if (t.utilOverride) continue;
      const sum = m.active.filter((e) => m.involves(e, t.id)).reduce((s, e) => s + m.allocationPct(t.id, e), 0);
      expect(t.util).toBe(Math.min(150, sum));
    }
  });
  it('never counts paused, closed, deleted or historical engagements as active', () => {
    expect(m.active.every((e) => e.status === 'active' && !e.historical)).toBe(true);
    expect(m.engagements.some((e) => e.status === 'deleted')).toBe(false);
  });
  it('gives supervisors a flat 15% and leads the tier lead rate', () => {
    const e = eng({ leadId: 'a', teamIds: ['a', 'b'], supervisorId: 's', workloadTier: 'Heavy & Complex' });
    expect(m.allocationPct('a', e)).toBe(65);
    expect(m.allocationPct('b', e)).toBe(50);
    expect(m.allocationPct('s', e)).toBe(15);
    expect(m.allocationPct('z', e)).toBe(0);
    expect(m.allocationPct('b', { ...e, allocationOverrides: { b: 10 } })).toBe(10);
  });
  it('excludes directors and Operations from recommendations, and ranks by fit', () => {
    const recs = m.recommendations('Real Estate', 'Research', 10);
    expect(recs.length).toBeGreaterThan(0);
    expect(recs.every((r) => r.talent.department !== 'Operations' && r.talent.title !== 'Business Consulting Director')).toBe(true);
    expect(recs.map((r) => r.fit)).toEqual([...recs.map((r) => r.fit)].sort((a, b) => b - a));
  });
  it('builds fresh teams of the requested size around the chosen leader', () => {
    const leader = m.openCapacity()[0];
    const team = m.suggestFreshTeam(leader.id, 3, () => 0.3);
    expect(team[0].id).toBe(leader.id);
    expect(new Set(team.map((t) => t.id)).size).toBe(3);
  });
  it('flags hiring gaps only for groups averaging at least 100%', () => {
    m.hiringNeeds().forEach((h) => expect(h.avgUtil).toBeGreaterThanOrEqual(100));
  });
  it('produces a grounded copilot context', () => {
    const ctx = m.copilotContext();
    expect(ctx).toContain(`${m.active.length} active engagements`);
    expect(ctx).toContain(m.talents[0].name);
  });
  it('has consistent year buckets', () => {
    const b = m.yearBuckets(2026);
    expect(b.completed.length).toBe(b.closed.length + b.historical.length);
  });
});
