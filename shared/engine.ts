/* The EEOS domain engine.
   buildModel() turns the raw workspace (people, engagements, rules, history) into every
   derived number the app shows: utilization, status, alerts, recommendations, rotation
   risk, hiring gaps, projections. It is pure and deterministic given `now`, and is used
   unchanged by the web app (rendering) and the API (exports, AI Copilot context). */
import {
  DEPARTMENTS, EXCLUDED_FROM_AUTO_STAFFING_DEPARTMENTS, EXCLUDED_FROM_AUTO_STAFFING_TITLES, FALLBACK_CAPACITY,
  LEADER_CONCENTRATION_THRESHOLD, MONTHS, RECOMMENDATION_WEIGHTS, SUPERVISOR_ALLOCATION_PCT, TITLES, UTIL_BANDS,
  WORKLOAD_TIERS,
} from './constants';
import { health, parseDay, priority, scheduleInfo, stageLabel, type Health } from './schedule';
import type { CapacityRule, Client, Engagement, Talent, WorkspaceData } from './types';

export type UtilStatus = 'Not Allocated' | 'Underutilized' | 'Optimal' | 'At Capacity' | 'Overutilized';
export const UTIL_STATUSES: UtilStatus[] = ['Underutilized', 'Optimal', 'At Capacity', 'Overutilized', 'Not Allocated'];

export interface DerivedTalent extends Talent {
  projectCapacity: number;
  leadershipCapacity: number;
  /** Active engagements this person is on (lead, team member or supervisor). */
  activeEngagementIds: string[];
  engagementCount: number;
  computedUtil: number;
  util: number;
  utilStatus: UtilStatus;
  sectors: string[];
}

export interface Alert {
  icon: string;
  tone: 'danger' | 'accent' | 'ok';
  title: string;
  desc: string;
  link?: string;
}

export interface Recommendation {
  talent: DerivedTalent;
  fit: number;
  breakdown: { capacity: number; rotation: number; scope: number; sector: number };
  reason: string;
}

export interface HiringNeed {
  title: string;
  department: string;
  headcount: number;
  avgUtil: number;
  urgency: 'High' | 'Medium' | 'Low';
  fteGap: number;
}

export interface Financials {
  price: number;
  cost: number;
  grossProfit: number;
  profitabilityPct: number;
}

export type EngagementBucket = 'active' | 'paused' | 'closed' | 'historical';

export function utilStatusFor(util: number, hasWork: boolean): UtilStatus {
  if (!hasWork) return 'Not Allocated';
  if (util > UTIL_BANDS.over) return 'Overutilized';
  if (util >= UTIL_BANDS.atCapacity) return 'At Capacity';
  if (util >= UTIL_BANDS.optimal) return 'Optimal';
  return 'Underutilized';
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return ((parts[0][0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function pairKey(a: string, b: string): string {
  return [a, b].sort().join('||');
}

const cap150 = (n: number) => Math.min(150, Math.round(n));

export class Model {
  readonly now: Date;
  readonly data: WorkspaceData;
  readonly talentById = new Map<string, Talent>();
  /** Every engagement that has not been deleted (active, paused, closed, historical). */
  readonly engagements: Engagement[];
  /** Live engagements: status active and not a historical record. The single definition of "active". */
  readonly active: Engagement[];
  private readonly rules = new Map<string, CapacityRule>();
  private _talents?: DerivedTalent[];

  constructor(data: WorkspaceData, now: Date = new Date()) {
    this.now = now;
    this.data = data;
    data.talents.forEach((t) => this.talentById.set(t.id, t));
    data.capacityRules.forEach((r) => this.rules.set(r.title + '__' + r.department, r));
    this.engagements = data.engagements.filter((e) => e.status !== 'deleted');
    this.active = this.engagements.filter((e) => e.status === 'active' && !e.historical);
  }

  // ---------- lookups ----------
  name(id: string | null | undefined): string {
    if (!id) return '—';
    return this.talentById.get(id)?.name ?? id;
  }
  capacity(title: string, department: string): { project: number; leadership: number; placeholder: boolean; defined: boolean } {
    const r = this.rules.get(title + '__' + department);
    return r ? { ...r, defined: true } : { ...FALLBACK_CAPACITY, placeholder: true, defined: false };
  }
  engagement(id: string): Engagement | undefined {
    return this.data.engagements.find((e) => e.id === id);
  }
  /** Lead, team and supervisor — everyone carrying load on the engagement. */
  members(e: Engagement): string[] {
    return [...new Set([e.leadId, ...e.teamIds, ...(e.supervisorId ? [e.supervisorId] : [])].filter(Boolean))];
  }
  /** Lead and team — the people who staff the work (supervisor excluded). Used for rotation. */
  staff(e: Engagement): string[] {
    return [...new Set([e.leadId, ...e.teamIds].filter(Boolean))];
  }
  involves(e: Engagement, talentId: string): boolean {
    return e.leadId === talentId || e.supervisorId === talentId || e.teamIds.includes(talentId);
  }
  bucket(e: Engagement): EngagementBucket {
    if (e.historical) return 'historical';
    if (e.status === 'closed') return 'closed';
    if (e.status === 'paused') return 'paused';
    return 'active';
  }

  // ---------- schedule ----------
  schedule(e: Engagement) { return scheduleInfo(e, this.now); }
  health(e: Engagement): Health { return health(e, this.now); }
  priority(e: Engagement) { return priority(e, this.now); }

  // ---------- allocation & utilization ----------
  allocationPct(talentId: string, e: Engagement): number {
    if (e.allocationOverrides[talentId] !== undefined) return e.allocationOverrides[talentId];
    if (!this.involves(e, talentId)) return 0;
    if (e.supervisorId === talentId && e.leadId !== talentId && !e.teamIds.includes(talentId)) return SUPERVISOR_ALLOCATION_PCT;
    const tier = WORKLOAD_TIERS[e.workloadTier] ?? WORKLOAD_TIERS['Quick Work'];
    return e.leadId === talentId ? tier.leader : tier.member;
  }

  private sectorsByTalent(): Map<string, string[]> {
    const map = new Map<string, Set<string>>();
    const add = (id: string | null, sector: string) => {
      if (!id || !sector) return;
      if (!map.has(id)) map.set(id, new Set());
      map.get(id)!.add(sector);
    };
    this.data.trajectory.forEach((r) => add(r.talentId, r.sector));
    this.engagements.forEach((e) => this.members(e).forEach((id) => add(id, e.sector)));
    return new Map([...map].map(([k, v]) => [k, [...v]]));
  }

  /** The active roster with live utilization. */
  get talents(): DerivedTalent[] {
    if (this._talents) return this._talents;
    const sectors = this.sectorsByTalent();
    this._talents = this.data.talents
      .filter((t) => t.status === 'active')
      .map((t) => {
        const cap = this.capacity(t.title, t.department);
        const mine = this.active.filter((e) => this.involves(e, t.id));
        const computedUtil = mine.length ? cap150(mine.reduce((s, e) => s + this.allocationPct(t.id, e), 0)) : 0;
        const util = t.utilOverride ? t.utilOverride.value : computedUtil;
        return {
          ...t,
          projectCapacity: cap.project,
          leadershipCapacity: cap.leadership,
          activeEngagementIds: mine.map((e) => e.id),
          engagementCount: mine.length,
          computedUtil,
          util,
          utilStatus: utilStatusFor(util, mine.length > 0 || !!t.utilOverride),
          sectors: sectors.get(t.id) ?? [],
        };
      });
    return this._talents;
  }
  talent(id: string): DerivedTalent | undefined {
    return this.talents.find((t) => t.id === id);
  }

  /** Average utilization of everyone who is allocated. */
  get firmUtilization(): number {
    const allocated = this.talents.filter((t) => t.utilStatus !== 'Not Allocated');
    return allocated.length ? Math.round(allocated.reduce((s, t) => s + t.util, 0) / allocated.length) : 0;
  }

  /** Utilization for one person in one calendar month (UTC).
      Past months use every engagement they were on; the current month is live; future months
      project active engagements forward from their real dates. */
  talentMonthUtil(t: DerivedTalent, year: number, month: number): { value: number | null; kind: 'past' | 'current' | 'projected' } {
    const curY = this.now.getUTCFullYear();
    const curM = this.now.getUTCMonth();
    const kind = year < curY || (year === curY && month < curM) ? 'past' : year === curY && month === curM ? 'current' : 'projected';
    if (kind === 'current') return { value: t.util, kind };
    const mStart = Date.UTC(year, month, 1);
    const mEnd = Date.UTC(year, month + 1, 1) - 1;
    const pool = kind === 'past' ? this.engagements : this.active;
    const overlapping = pool.filter((e) => {
      if (!this.involves(e, t.id)) return false;
      const s = parseDay(e.start).getTime();
      const en = parseDay(e.end).getTime();
      return s <= mEnd && en >= mStart;
    });
    if (kind === 'past' && !overlapping.length) return { value: null, kind };
    return { value: cap150(overlapping.reduce((s, e) => s + this.allocationPct(t.id, e), 0)), kind };
  }

  /** Firm-wide monthly utilization for a calendar year.
      Months covered by the trajectory log use it (staffing count ÷ project capacity);
      other months fall back to engagement date ranges. */
  monthlyTrend(year: number): { label: string; value: number | null; source: 'trajectory' | 'engagements' | 'projected' }[] {
    const deptByTalent = new Map(this.data.talents.map((t) => [t.id, t.department]));
    return MONTHS.map((label, m) => {
      const rows = this.data.trajectory.filter((r) => r.year === year && r.month === label);
      if (rows.length) {
        const byTalent = new Map<string, { n: number; title: string; dept: string }>();
        rows.forEach((r) => {
          const key = r.talentId ?? r.talent;
          const cur = byTalent.get(key) ?? { n: 0, title: r.title, dept: (r.talentId && deptByTalent.get(r.talentId)) || 'Consulting' };
          cur.n++;
          byTalent.set(key, cur);
        });
        const utils = [...byTalent.values()].map((v) => cap150((v.n / (this.capacity(v.title, v.dept).project || 4)) * 100));
        return { label, value: Math.round(utils.reduce((a, b) => a + b, 0) / utils.length), source: 'trajectory' as const };
      }
      const values = this.talents.map((t) => this.talentMonthUtil(t, year, m)).filter((v) => v.value !== null && v.value > 0);
      if (!values.length) return { label, value: null, source: 'engagements' as const };
      const avg = Math.round(values.reduce((s, v) => s + (v.value ?? 0), 0) / values.length);
      return { label, value: avg, source: values[0].kind === 'projected' ? ('projected' as const) : ('engagements' as const) };
    });
  }

  trendYears(): number[] {
    const years = new Set(this.data.trajectory.map((r) => r.year));
    years.add(this.now.getUTCFullYear());
    return [...years].sort();
  }

  // ---------- staffing intelligence ----------
  recommendations(sector: string, scope: string, count = 5): Recommendation[] {
    const pool = this.talents.filter(
      (t) => !EXCLUDED_FROM_AUTO_STAFFING_TITLES.includes(t.title) && !EXCLUDED_FROM_AUTO_STAFFING_DEPARTMENTS.includes(t.department),
    );
    if (!pool.length) return [];
    const maxEng = Math.max(1, ...pool.map((t) => t.engagementCount));
    const scopeKey = scope.toLowerCase().slice(0, 6);
    return pool
      .map((t) => {
        const capacity = Math.max(0, 100 - t.util);
        const rotation = 100 - (t.engagementCount / maxEng) * 100;
        const scopeHistory = scope ? this.engagements.filter((e) => this.involves(e, t.id) && e.scope.toLowerCase().includes(scopeKey)) : [];
        const scopeScore = scope ? Math.min(100, scopeHistory.length * 40) : Math.min(100, t.engagementCount * 20);
        const sectorMatch = !!sector && t.sectors.includes(sector);
        const sectorScore = sectorMatch ? 100 : sector ? 25 : 50;
        const w = RECOMMENDATION_WEIGHTS;
        const fit = Math.round(capacity * w.capacity + rotation * w.rotation + scopeScore * w.scope + sectorScore * w.sector);
        const reason = [
          sectorMatch ? `${sector} sector experience` : null,
          t.util < 75 ? 'strong available capacity' : t.util < 91 ? 'moderate available capacity' : 'limited capacity',
          scopeHistory.length ? `${scopeHistory.length} prior ${scope} engagement${scopeHistory.length > 1 ? 's' : ''}` : null,
        ].filter(Boolean).join(', ');
        return {
          talent: t,
          fit,
          breakdown: { capacity: Math.round(capacity), rotation: Math.round(rotation), scope: Math.round(scopeScore), sector: Math.round(sectorScore) },
          reason,
        };
      })
      .sort((a, b) => b.fit - a.fit)
      .slice(0, count);
  }

  /** People with open project slots right now, most slots first. */
  openCapacity(): (DerivedTalent & { openSlots: number })[] {
    return this.talents
      .filter((t) => t.department !== 'Operations' && t.utilStatus !== 'Overutilized')
      .map((t) => ({ ...t, openSlots: Math.max(0, t.projectCapacity - t.engagementCount) }))
      .filter((t) => t.openSlots > 0)
      .sort((a, b) => b.openSlots - a.openSlots || a.util - b.util);
  }

  /** Repeated pairings and over-concentrated leaders across the live portfolio. */
  rotationRisk() {
    const pairs = new Map<string, { count: number; engagements: string[] }>();
    const leaders = new Map<string, { count: number; engagements: string[] }>();
    this.active.forEach((e) => {
      const l = leaders.get(e.leadId) ?? { count: 0, engagements: [] };
      l.count++;
      l.engagements.push(e.name);
      leaders.set(e.leadId, l);
      const people = this.staff(e);
      for (let i = 0; i < people.length; i++)
        for (let j = i + 1; j < people.length; j++) {
          const k = pairKey(people[i], people[j]);
          const p = pairs.get(k) ?? { count: 0, engagements: [] };
          p.count++;
          p.engagements.push(e.name);
          pairs.set(k, p);
        }
    });
    const repeatPairs = [...pairs]
      .filter(([, v]) => v.count >= 2)
      .map(([k, v]) => {
        const [a, b] = k.split('||');
        return { a, b, aName: this.name(a), bName: this.name(b), ...v };
      })
      .sort((x, y) => y.count - x.count);
    const concentratedLeaders = [...leaders]
      .filter(([, v]) => v.count >= LEADER_CONCENTRATION_THRESHOLD)
      .map(([id, v]) => ({ id, name: this.name(id), ...v }))
      .sort((x, y) => y.count - x.count);
    return { repeatPairs, concentratedLeaders };
  }

  /** How many times each pair has worked together, across the firm's whole history. */
  historyPairCounts(): Map<string, number> {
    const counts = new Map<string, number>();
    this.engagements.forEach((e) => {
      const people = this.staff(e);
      for (let i = 0; i < people.length; i++)
        for (let j = i + 1; j < people.length; j++) {
          const k = pairKey(people[i], people[j]);
          counts.set(k, (counts.get(k) ?? 0) + 1);
        }
    });
    return counts;
  }

  /** Greedy "fresh team": start from the leader, add whoever has worked least with the team so far. */
  suggestFreshTeam(leaderId: string | null, size: number, rng: () => number = Math.random): DerivedTalent[] {
    const pairCounts = this.historyPairCounts();
    const eligible = this.talents.filter((t) => t.department !== 'Operations' && t.utilStatus !== 'Overutilized');
    if (eligible.length < 2) return [];
    const target = Math.min(eligible.length, Math.max(2, size));
    const shuffled = [...eligible].sort(() => rng() - 0.5);
    const leader = (leaderId && eligible.find((t) => t.id === leaderId)) || shuffled[0];
    const team = [leader];
    while (team.length < target) {
      let best: DerivedTalent | null = null;
      let bestScore = Infinity;
      for (const c of shuffled) {
        if (team.some((x) => x.id === c.id)) continue;
        const score = team.reduce((s, x) => s + (pairCounts.get(pairKey(x.id, c.id)) ?? 0), 0);
        if (score < bestScore || (score === bestScore && rng() < 0.5)) {
          bestScore = score;
          best = c;
        }
      }
      if (!best) break;
      team.push(best);
    }
    return team;
  }

  teamRationale(team: DerivedTalent[]) {
    const pairCounts = this.historyPairCounts();
    const [leader, ...members] = team;
    const pairRows: { a: string; b: string; count: number }[] = [];
    for (let i = 0; i < team.length; i++)
      for (let j = i + 1; j < team.length; j++) pairRows.push({ a: team[i].name, b: team[j].name, count: pairCounts.get(pairKey(team[i].id, team[j].id)) ?? 0 });
    const neverTogether = pairRows.filter((p) => p.count === 0).length;
    const freshToLeader = members.filter((m) => !(pairCounts.get(pairKey(leader.id, m.id)) ?? 0));
    const sectors = new Set(team.flatMap((t) => t.sectors));
    const hasLed = (id: string) => this.engagements.some((e) => e.leadId === id) || this.data.trajectory.some((r) => r.talentId === id && r.role === 'Leader');
    const neverLed = members.filter((m) => !hasLed(m.id));
    const reasons = [
      { met: neverTogether > 0, text: `${neverTogether} of ${pairRows.length} pairings have never worked together before` },
      { met: freshToLeader.length > 0, text: freshToLeader.length ? `First time working with ${leader.name}: ${freshToLeader.map((m) => m.name).join(', ')}` : `Everyone here has already worked with ${leader.name}` },
      { met: sectors.size > 1, text: sectors.size > 1 ? `Brings experience across ${sectors.size} sectors` : 'Little sector diversity in this team' },
      { met: neverLed.length > 0, text: neverLed.length ? `Growth opportunity — hasn't led an engagement yet: ${neverLed.map((m) => m.name).join(', ')}` : 'Everyone already has leadership experience' },
    ];
    return { pairRows, reasons };
  }

  /** People who already share another live engagement with this proposed team. */
  overlapsWithActive(proposed: string[]): { engagement: string; shared: string[] }[] {
    const ids = [...new Set(proposed.filter(Boolean))];
    if (ids.length < 2) return [];
    return this.active
      .map((e) => ({ engagement: e.name, shared: ids.filter((p) => this.staff(e).includes(p)).map((id) => this.name(id)) }))
      .filter((o) => o.shared.length >= 2);
  }

  // ---------- planning ----------
  hiringNeeds(): HiringNeed[] {
    const needs: HiringNeed[] = [];
    for (const r of this.data.capacityRules) {
      const grp = this.talents.filter((t) => t.title === r.title && t.department === r.department);
      if (!grp.length || r.project <= 0) continue;
      const avgUtil = Math.round(grp.reduce((s, t) => s + t.util, 0) / grp.length);
      if (avgUtil < 100) continue;
      const demand = grp.reduce((s, t) => s + t.engagementCount, 0);
      const fteGap = Math.max(1, Math.ceil((demand - grp.length * r.project) / r.project));
      needs.push({ title: r.title, department: r.department, headcount: grp.length, avgUtil, urgency: avgUtil >= 130 ? 'High' : avgUtil >= 105 ? 'Medium' : 'Low', fteGap });
    }
    const rank = { High: 0, Medium: 1, Low: 2 };
    return needs.sort((a, b) => rank[a.urgency] - rank[b.urgency] || b.avgUtil - a.avgUtil);
  }

  rolePlanning() {
    return this.orderedRules()
      .map((r) => {
        const grp = this.talents.filter((t) => t.title === r.title && t.department === r.department);
        return { ...r, headcount: grp.length, avgUtil: grp.length ? Math.round(grp.reduce((s, t) => s + t.util, 0) / grp.length) : 0 };
      })
      .filter((r) => r.headcount > 0);
  }

  orderedRules(): CapacityRule[] {
    const ti = (t: string) => (TITLES.indexOf(t) + 1 || 99);
    const di = (d: string) => (DEPARTMENTS.indexOf(d) + 1 || 99);
    return [...this.data.capacityRules].sort((a, b) => ti(a.title) - ti(b.title) || di(a.department) - di(b.department));
  }

  /** Demand from scheduled engagements vs. Consulting + Pulse capacity for the next N months. */
  capacityProjection(months = 6) {
    const talents = this.talents.filter((t) => t.department !== 'Operations');
    const ids = new Set(talents.map((t) => t.id));
    const y = this.now.getUTCFullYear();
    const m = this.now.getUTCMonth();
    const out = [];
    for (let i = 0; i < months; i++) {
      const mStart = Date.UTC(y, m + i, 1);
      const mEnd = Date.UTC(y, m + i + 1, 1) - 1;
      let demand = 0;
      this.active.forEach((e) => {
        if (parseDay(e.end).getTime() < mStart || parseDay(e.start).getTime() > mEnd) return;
        this.members(e).forEach((id) => { if (ids.has(id)) demand += this.allocationPct(id, e); });
      });
      const d = new Date(mStart);
      out.push({ label: MONTHS[d.getUTCMonth()] + ' ' + String(d.getUTCFullYear()).slice(2), demandPct: Math.round(demand / Math.max(1, talents.length * 100) * 100) });
    }
    return { months: out, talentCount: talents.length };
  }

  // ---------- clients ----------
  clients(): (Client & { active: number; historical: number })[] {
    const known = new Set(this.data.clients.map((c) => c.name));
    const extra: Client[] = [...new Set(this.engagements.map((e) => e.client).filter((n) => n && !known.has(n)))].map((name, i) => {
      const e = this.engagements.find((x) => x.client === name)!;
      return { id: 'derived-' + i, name, industry: e.sector, country: e.country, owner: this.name(e.leadId) };
    });
    return [...this.data.clients, ...extra].map((c) => ({
      ...c,
      active: this.active.filter((e) => e.client === c.name).length,
      historical: this.engagements.filter((e) => e.client === c.name && (e.historical || e.status === 'closed')).length,
    }));
  }

  clientTalents(clientName: string) {
    const projects = new Map<string, Set<string>>();
    this.engagements
      .filter((e) => e.client === clientName && e.status !== 'paused')
      .forEach((e) => this.staff(e).forEach((id) => {
        if (!projects.has(id)) projects.set(id, new Set());
        projects.get(id)!.add(e.name);
      }));
    return [...projects].map(([id, set]) => ({ id, name: this.name(id), projects: [...set] })).sort((a, b) => b.projects.length - a.projects.length);
  }

  // ---------- portfolio ----------
  financials(e: Engagement): Financials | null {
    if (e.price === null || e.cost === null) return null;
    const grossProfit = e.price - e.cost;
    return { price: e.price, cost: e.cost, grossProfit, profitabilityPct: e.price > 0 ? Math.round((grossProfit / e.price) * 1000) / 10 : 0 };
  }

  yearBuckets(year = this.now.getUTCFullYear()) {
    const isDone = (e: Engagement) => e.historical || e.status === 'closed';
    const yr = (s: string) => parseDay(s).getUTCFullYear();
    const touching = this.engagements.filter((e) => yr(e.start) <= year && yr(e.end) >= year);
    const done = this.engagements.filter((e) => isDone(e) && yr(e.end) === year);
    const active = touching.filter((e) => !isDone(e) && e.status !== 'paused');
    const yStart = Date.UTC(year, 0, 1);
    const yEnd = Date.UTC(year + 1, 0, 1);
    return {
      year,
      total: touching,
      completed: done,
      active,
      paused: touching.filter((e) => !isDone(e) && e.status === 'paused'),
      closed: done.filter((e) => !e.historical),
      historical: done.filter((e) => e.historical),
      readyToClose: active.filter((e) => this.health(e) === 'Complete'),
      completionRate: touching.length ? Math.round((done.length / touching.length) * 100) : 0,
      yearPct: Math.round(Math.min(1, Math.max(0, (this.now.getTime() - yStart) / (yEnd - yStart))) * 100),
    };
  }

  sectorDistribution() {
    const by = new Map<string, Engagement[]>();
    this.engagements.forEach((e) => {
      const s = e.sector || 'Unspecified';
      by.set(s, [...(by.get(s) ?? []), e]);
    });
    return [...by].map(([sector, engagements]) => ({ sector, engagements })).sort((a, b) => b.engagements.length - a.engagements.length);
  }

  // ---------- alerts ----------
  alerts(): Alert[] {
    const t = this.talents;
    const list = (names: string[], n: number) => names.slice(0, n).join(', ') + (names.length > n ? ` +${names.length - n} more` : '');
    const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
    const out: Alert[] = [];
    const over = t.filter((x) => x.util > 100);
    if (over.length) out.push({ icon: '⚠', tone: 'danger', link: '/traffic/monitor', title: `${over.length} ${plural(over.length, 'talent is', 'talents are')} over capacity`, desc: list(over.map((x) => `${x.name} (${x.util}%)`), 4) });
    const flagged = t.filter((x) => x.flag);
    if (flagged.length) out.push({ icon: '🚩', tone: 'danger', link: '/traffic/monitor', title: `${flagged.length} ${plural(flagged.length, 'talent', 'talents')} flagged for reallocation`, desc: list(flagged.map((x) => x.name), 4) });
    const understaffed = this.active.filter((e) => e.teamIds.length <= 1);
    if (understaffed.length) out.push({ icon: '👤', tone: 'danger', link: '/engagements/status', title: `${understaffed.length} ${plural(understaffed.length, 'engagement has', 'engagements have')} only a lead assigned`, desc: list(understaffed.map((e) => e.name), 3) });
    const delayed = this.active.filter((e) => this.health(e) === 'Delayed');
    if (delayed.length) out.push({ icon: '⏰', tone: 'danger', link: '/engagements/status', title: `${delayed.length} ${plural(delayed.length, 'engagement is', 'engagements are')} past the planned end date`, desc: list(delayed.map((e) => e.name), 3) });
    const closing = this.active.filter((e) => this.health(e) === 'About to Close');
    if (closing.length) out.push({ icon: 'ⓘ', tone: 'accent', link: '/engagements/lifecycle', title: `${closing.length} ${plural(closing.length, 'engagement is', 'engagements are')} closing soon`, desc: list(closing.map((e) => e.name), 3) });
    const bench = t.filter((x) => x.utilStatus === 'Not Allocated' && x.department !== 'Operations');
    if (bench.length) out.push({ icon: 'ⓘ', tone: 'accent', link: '/talents', title: `${bench.length} ${plural(bench.length, 'talent is', 'talents are')} unallocated`, desc: list(bench.map((x) => x.name), 4) });
    const rot = this.rotationRisk();
    if (rot.repeatPairs.length) out.push({ icon: '🔁', tone: 'danger', link: '/engagements/suggestions', title: `${rot.repeatPairs.length} team ${plural(rot.repeatPairs.length, 'pairing', 'pairings')} repeated across current engagements`, desc: list(rot.repeatPairs.map((p) => `${p.aName} + ${p.bName} (${p.count}x)`), 3) });
    if (rot.concentratedLeaders.length) out.push({ icon: '🔁', tone: 'danger', link: '/engagements/suggestions', title: `${rot.concentratedLeaders.length} ${plural(rot.concentratedLeaders.length, 'leader is', 'leaders are')} leading ${LEADER_CONCENTRATION_THRESHOLD}+ concurrent engagements`, desc: list(rot.concentratedLeaders.map((l) => `${l.name} (${l.count})`), 3) });
    return out;
  }

  // ---------- AI Copilot grounding ----------
  copilotContext(): string {
    const t = this.talents;
    const e = this.active;
    const rot = this.rotationRisk();
    const hiring = this.hiringNeeds();
    const clients = this.clients().filter((c) => c.active > 0).sort((a, b) => b.active - a.active);
    const or = (s: string) => s || 'None';
    return [
      `LIVE EEOS DATA SNAPSHOT (${this.now.toISOString().slice(0, 10)})`,
      `FIRM OVERVIEW: ${e.length} active engagements, ${t.length} talents on the roster, firm utilization ${this.firmUtilization}%, ${clients.length} clients with active work.`,
      `OVERUTILIZED (>100%): ${or(t.filter((x) => x.util > 100).map((x) => `${x.name} (${x.title}, ${x.department}) ${x.util}%`).join('; '))}`,
      `FLAGGED FOR REALLOCATION: ${or(t.filter((x) => x.flag).map((x) => x.name).join(', '))}`,
      `UNALLOCATED: ${or(t.filter((x) => x.utilStatus === 'Not Allocated').map((x) => `${x.name} (${x.title}, ${x.department})`).join('; '))}`,
      `UNDERSTAFFED (lead only): ${or(e.filter((x) => x.teamIds.length <= 1).map((x) => `${x.name} (${x.client}, lead ${this.name(x.leadId)})`).join('; '))}`,
      `CLOSING SOON: ${or(e.filter((x) => this.health(x) === 'About to Close').map((x) => `${x.name} (${x.client})`).join('; '))}`,
      `DELAYED: ${or(e.filter((x) => this.health(x) === 'Delayed').map((x) => `${x.name} (ended ${x.end})`).join('; '))}`,
      `HIRING GAPS (title × department averaging ≥100%): ${or(hiring.map((h) => `${h.title} in ${h.department} — ${h.avgUtil}% avg, ${h.urgency}, ~${h.fteGap} FTE`).join('; '))}`,
      `REPEATED PAIRINGS (active work): ${or(rot.repeatPairs.map((p) => `${p.aName} + ${p.bName} (${p.count}: ${p.engagements.join(', ')})`).join('; '))}`,
      `LEADERS ON ${LEADER_CONCENTRATION_THRESHOLD}+ ENGAGEMENTS: ${or(rot.concentratedLeaders.map((l) => `${l.name} (${l.count}: ${l.engagements.join(', ')})`).join('; '))}`,
      `TOP CLIENTS BY ACTIVE ENGAGEMENTS: ${or(clients.slice(0, 5).map((c) => `${c.name} (${c.active})`).join(', '))}`,
      `ROSTER: ${t.map((x) => `${x.name} [${x.title}, ${x.department}, ${x.util}% ${x.utilStatus}, ${x.engagementCount}/${x.projectCapacity} engagements]`).join(' | ')}`,
      `ACTIVE ENGAGEMENTS: ${e.map((x) => `${x.name} [${x.client}, ${x.sector}, ${x.scope}, stage ${stageLabel(x.stage)}, lead ${this.name(x.leadId)}, team ${x.teamIds.map((id) => this.name(id)).join('/')}, ${x.start}→${x.end}, ${this.health(x)}, ${x.workloadTier}]`).join(' | ')}`,
    ].join('\n\n');
  }
}

export function buildModel(data: WorkspaceData, now?: Date): Model {
  return new Model(data, now);
}

export function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined) return 'N/A';
  const abs = Math.abs(n);
  const s = abs >= 1_000_000 ? (abs / 1_000_000).toFixed(2) + 'M' : (abs / 1000).toFixed(0) + 'K';
  return (n < 0 ? '-' : '') + '$' + s;
}
