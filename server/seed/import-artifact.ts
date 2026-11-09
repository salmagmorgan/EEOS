/* Convert the original single-file EEOS prototype (the Claude artifact HTML) into an EEOS seed file.

   Usage:
     npm run import:artifact -- <artifact.html> [--store <store.json>] [--out <seed.json>] [--anonymize]

   - Reads the roster, client list, capacity sheet, open engagements and the trajectory log
     embedded in the HTML, plus the shared "STORE" (everyone's edits). Pass --store to use a
     newer export of the shared store instead of the snapshot embedded in the HTML.
   - --anonymize replaces every person, client and engagement name with a placeholder. The
     committed demo seed is produced this way so no real business data lands in git.

   The output is loaded with `npm run seed -- <seed.json>` (or set SEED_PATH before first start). */
import fs from 'node:fs';
import vm from 'node:vm';
import { SCOPE_STAGES, STAGE_IDS, WORKLOAD_TIER_NAMES, type StageId, type WorkloadTier } from '../../shared/constants';
import { initialsOf } from '../../shared/engine';
import { addDays, scopeStages, toDay } from '../../shared/schedule';
import type { CapacityRule, Client, CpsStage, Engagement, SeedFile, Talent, TrajectoryRow } from '../../shared/types';

type Literal = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Find `const NAME = <literal>` (or `let`) and return the literal's source by bracket matching. */
function extractLiteral(src: string, name: string): string {
  const m = new RegExp(`(?:const|let)\\s+${name}\\s*=\\s*`).exec(src);
  if (!m) throw new Error(`Could not find ${name} in the artifact`);
  let i = m.index + m[0].length;
  const open = src[i];
  const close = open === '[' ? ']' : open === '{' ? '}' : null;
  if (!close) throw new Error(`${name} is not an array/object literal`);
  let depth = 0;
  let quote: string | null = null;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return src.slice(m.index + m[0].length, i + 1);
  }
  throw new Error(`Unterminated literal for ${name}`);
}

/** Evaluate a data literal in an empty sandbox (no require, no globals, 1s timeout). */
function evalLiteral(code: string): Literal {
  return vm.runInNewContext('(' + code + ')', Object.create(null), { timeout: 1000 });
}

const MONTH_NUM: Record<string, number> = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
const TYPE_DAYS: Record<string, number> = { Research: 90, Strategy: 75, Execution: 120 };
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function seedFromArtifact(html: string, opts: { store?: Literal; now?: Date; anonymize?: boolean } = {}): SeedFile {
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();
  const roster: { name: string; title: string; department: string }[] = evalLiteral(extractLiteral(html, 'REAL_TALENTS'));
  const clientsSrc: { id: string; name: string; industry: string; country: string; owner: string }[] = evalLiteral(extractLiteral(html, 'CLIENTS'));
  const capacity: Record<string, Record<string, { project: number; leadership: number }>> = evalLiteral(extractLiteral(html, 'CAPACITY_MATRIX'));
  const openSrc: Literal[] = evalLiteral(extractLiteral(html, 'OPEN_ENGAGEMENT_SOURCE'));
  const trajectorySrc: Literal[][] = evalLiteral(extractLiteral(html, 'TRAJECTORY_LOG'));
  const store: Literal = opts.store ?? evalLiteral(extractLiteral(html, 'STORE'));
  const departedMatch = /PERMANENTLY_DEPARTED_TALENT_IDS\s*=\s*(\[[^\]]*\])/.exec(html);
  const departed: string[] = departedMatch ? evalLiteral(departedMatch[1]) : [];

  // ---- talents (ids t0..tN kept so the store's overrides still line up) ----
  const talents: Talent[] = roster.map((r, i) => ({
    id: 't' + i, name: r.name, initials: initialsOf(r.name), title: r.title, department: r.department,
    status: 'active', utilOverride: null, flag: null, createdAt: nowIso, updatedAt: nowIso,
  }));
  for (const t of store.newTalents ?? []) {
    talents.push({ id: t.id, name: t.name, initials: initialsOf(t.name), title: t.title, department: t.department, status: 'active', utilOverride: null, flag: null, createdAt: nowIso, updatedAt: nowIso });
  }
  for (const [id, edit] of Object.entries<Literal>(store.talentEdits ?? {})) {
    const t = talents.find((x) => x.id === id);
    if (t) Object.assign(t, edit, { initials: initialsOf(edit.name ?? t.name) });
  }
  // Snapshot the names the prototype used, *before* edits, so name-based references resolve.
  const byName = new Map<string, Talent>();
  roster.forEach((r, i) => byName.set(r.name, talents[i]));
  talents.forEach((t) => byName.set(t.name, t));
  departed.forEach((id) => { const t = talents.find((x) => x.id === id); if (t) t.status = 'alumni'; });
  (store.removedTalents ?? []).forEach((id: string) => { const t = talents.find((x) => x.id === id); if (t && t.status === 'active') t.status = 'removed'; });
  for (const [id, f] of Object.entries<Literal>(store.flags ?? {})) {
    const t = talents.find((x) => x.id === id);
    if (t) t.flag = { by: f.by ?? 'Unknown', at: f.at ?? nowIso };
  }
  for (const [id, o] of Object.entries<Literal>(store.utilizationOverrides ?? {})) {
    const t = talents.find((x) => x.id === id);
    if (t) t.utilOverride = { value: Number(o.value), reason: o.reason ?? '', by: o.by ?? 'Unknown', at: o.at ?? nowIso };
  }
  /** Resolve a person by name; unknown names (people who appear only in history) become alumni. */
  const idFor = (name: string | null | undefined): string | null => {
    if (!name) return null;
    const hit = byName.get(name);
    if (hit) return hit.id;
    const t: Talent = { id: 'ta-' + slug(name), name, initials: initialsOf(name), title: 'Former team member', department: 'Consulting', status: 'alumni', utilOverride: null, flag: null, createdAt: nowIso, updatedAt: nowIso };
    talents.push(t);
    byName.set(name, t);
    return t.id;
  };

  // ---- capacity rules ----
  const PLACEHOLDER_TITLES = ['Principal', 'Venture Partner', 'People and Culture Associate Manager'];
  const capacityRules: CapacityRule[] = [];
  for (const [title, depts] of Object.entries(capacity))
    for (const [department, c] of Object.entries(depts)) {
      const ov = store.capacityOverrides?.[title + '__' + department];
      capacityRules.push({ title, department, project: ov?.project ?? c.project, leadership: ov?.leadership ?? c.leadership, placeholder: !ov && PLACEHOLDER_TITLES.includes(title) });
    }

  // ---- engagements ----
  const mkEngagement = (base: Partial<Engagement> & Pick<Engagement, 'id' | 'name' | 'client' | 'sector' | 'scope' | 'stage' | 'start' | 'end'>, leadName: string, teamNames: string[], supervisorName?: string | null): Engagement => {
    const leadId = idFor(leadName)!;
    const supervisorId = idFor(supervisorName ?? null);
    const teamIds = [...new Set(teamNames.map((n) => idFor(n)!).filter((id) => id && id !== supervisorId))];
    return {
      country: 'Egypt', subScope: null, notes: '', workloadTier: 'Quick Work', customCps: null, price: null, cost: null,
      status: 'active', historical: false, allocationOverrides: {}, createdAt: nowIso, updatedAt: nowIso,
      ...base, leadId, teamIds: teamIds.length ? teamIds : [leadId], supervisorId,
    };
  };

  const engagements: Engagement[] = [];
  openSrc.forEach((src, i) => {
    const scope = SCOPE_STAGES[src.realScope as keyof typeof SCOPE_STAGES] ? src.realScope : 'Research';
    const stages = scopeStages(scope).map((s) => s.id);
    const start = new Date(Date.UTC(src.startY, src.startM - 1, 1));
    const est = addDays(start, TYPE_DAYS[src.realScope] ?? 90);
    const min = addDays(now, 30);
    engagements.push(mkEngagement({
      id: 'e' + i, name: src.name, client: src.client, sector: src.sector, scope,
      stage: stages.length > 2 ? stages[Math.floor((stages.length - 1) / 2)] : stages[0],
      start: toDay(start), end: toDay(est > min ? est : min),
    }, src.lead, src.team));
  });
  for (const ue of store.newEngagements ?? []) {
    engagements.push(mkEngagement({
      id: ue.id, name: ue.name, client: ue.client || 'Unassigned', country: ue.country && ue.country !== '—' ? ue.country : 'Egypt',
      sector: ue.sector || 'Unspecified', scope: ue.scope in SCOPE_STAGES ? ue.scope : 'Research', subScope: ue.subScope ?? null,
      stage: ue.stage, start: ue.start, end: ue.end, notes: ue.notes ?? '', customCps: ue.customCPS ?? null,
    }, ue.lead, ue.team ?? [], ue.supervisor));
  }

  // Historical closed engagements — one per distinct closed engagement in the trajectory log.
  const closedRows = trajectorySrc.filter((r) => r[5] === 'Closed');
  const grouped = new Map<string, Literal[][]>();
  closedRows.forEach((r) => grouped.set(r[2], [...(grouped.get(r[2]) ?? []), r]));
  [...grouped].forEach(([name, rows], i) => {
    const leaders = rows.filter((r) => r[8] === 'Leader');
    const lead = leaders.length ? leaders[leaders.length - 1][6] : rows[0][6];
    const dates = rows.map((r) => Date.UTC(r[0], MONTH_NUM[r[1]] - 1, 1));
    const start = new Date(Math.min(...dates));
    let end = new Date(Math.max(...dates));
    if (end.getTime() === start.getTime()) end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 2, 1));
    const scope = rows[0][4] in SCOPE_STAGES ? rows[0][4] : 'Research';
    const stages = scopeStages(scope);
    engagements.push(mkEngagement({
      id: 'hc' + i, name, client: rows[0][9], sector: rows[0][3], scope, stage: stages[stages.length - 1].id,
      start: toDay(start), end: toDay(end), historical: true, status: 'closed',
    }, lead, rows.map((r) => r[6])));
  });

  // ---- apply the shared store's edits ----
  const eng = (id: string) => engagements.find((e) => e.id === id);
  for (const [id, ov] of Object.entries<Literal>(store.stageOverrides ?? {})) { const e = eng(id); if (e && STAGE_IDS.includes(ov.stage)) e.stage = ov.stage as StageId; }
  for (const [id, ov] of Object.entries<Literal>(store.teamOverrides ?? {})) {
    const e = eng(id);
    if (!e) continue;
    e.leadId = idFor(ov.lead) ?? e.leadId;
    if ('supervisor' in ov) e.supervisorId = idFor(ov.supervisor);
    const team = (ov.team ?? []).map((n: string) => idFor(n)).filter((x: string | null) => x && x !== e.supervisorId);
    e.teamIds = team.length ? team : [e.leadId];
  }
  for (const [id, tier] of Object.entries<Literal>(store.workloadTiers ?? {})) { const e = eng(id); if (e && WORKLOAD_TIER_NAMES.includes(tier)) e.workloadTier = tier as WorkloadTier; }
  for (const [id, cps] of Object.entries<Literal>(store.customCPSOverrides ?? {})) { const e = eng(id); if (e) e.customCps = cps as CpsStage[]; }
  for (const [id, f] of Object.entries<Literal>(store.financials ?? {})) { const e = eng(id); if (e) { e.price = Number(f.price) || 0; e.cost = Number(f.cost) || 0; } }
  for (const [key, pct] of Object.entries<Literal>(store.allocationOverrides ?? {})) {
    const [tid, eid] = key.split('__');
    const e = eng(eid);
    if (e) e.allocationOverrides[tid] = Number(pct);
  }
  (store.pausedEngagements ?? []).forEach((id: string) => { const e = eng(id); if (e && !e.historical) e.status = 'paused'; });
  (store.closedEngagements ?? []).forEach((id: string) => { const e = eng(id); if (e && !e.historical) e.status = 'closed'; });
  (store.deletedEngagements ?? []).forEach((id: string) => { const e = eng(id); if (e && !e.historical) e.status = 'deleted'; });

  // ---- clients (plus any client only referenced by an engagement) ----
  const clients: Client[] = clientsSrc.map((c) => ({ id: c.id, name: c.name, industry: c.industry === 'Govermental' ? 'Governmental' : c.industry, country: c.country, owner: c.owner }));
  for (const e of engagements) {
    if (e.sector === 'Govermental') e.sector = 'Governmental';
    if (!clients.some((c) => c.name === e.client))
      clients.push({ id: 'c-' + slug(e.client), name: e.client, industry: e.sector, country: e.country, owner: talents.find((t) => t.id === e.leadId)?.name ?? 'Unassigned' });
  }

  // ---- trajectory ----
  const trajectory: Omit<TrajectoryRow, 'id'>[] = trajectorySrc.map((r) => ({
    year: r[0], month: r[1], engagement: r[2], sector: r[3] === 'Govermental' ? 'Governmental' : r[3], scope: r[4], status: r[5],
    talent: r[6], talentId: idFor(r[6]), title: r[7], role: r[8], client: r[9],
  }));

  const audit = (store.auditLog ?? []).map((a: Literal) => ({ at: a.at, userName: a.by, action: a.action, entityName: a.entityName ?? '', details: a.details ?? '' }));
  const seed: SeedFile = {
    generatedAt: nowIso,
    description: 'Imported from the EEOS prototype artifact',
    talents, engagements, clients, capacityRules, trajectory, audit,
  };
  return opts.anonymize ? anonymize(seed) : seed;
}

/** Replace every real person/client/engagement name. Structure, dates and numbers are kept. */
export function anonymize(seed: SeedFile): SeedFile {
  const FIRST = ['Amira', 'Omar', 'Layla', 'Karim', 'Nour', 'Yassin', 'Hana', 'Tawfik', 'Selim', 'Ali', 'Mona', 'Fady', 'Dina', 'Hesham', 'Rania', 'Sherif', 'Malak', 'Ziad', 'Farida', 'Mostafa', 'Jana', 'Adel', 'Reem', 'Kamal', 'Lina', 'Amr', 'Yara', 'Samir', 'Noha', 'Basel', 'Hoda', 'Waleed', 'Mai', 'Ehab', 'Sara', 'Galal', 'Rasha', 'Ihab', 'Loubna', 'Nabil', 'Aya', 'Fouad'];
  const LAST = ['Adly', 'Badawi', 'Chahine', 'Darwish', 'Ezzat', 'Fahmy', 'Ghali', 'Hegazy', 'Ibrahim', 'Kamel', 'Lotfy', 'Mansour', 'Naguib', 'Osman', 'Qassem', 'Rashed', 'Sabry', 'Taher', 'Wahba', 'Yassin', 'Zaki'];
  const COMPANY = ['Atlas', 'Beacon', 'Cedar', 'Delta', 'Ember', 'Falcon', 'Granite', 'Harbor', 'Iris', 'Juniper', 'Keystone', 'Lotus', 'Meridian', 'Nile', 'Orion', 'Pillar', 'Quartz', 'Riverstone', 'Sahara', 'Tidal', 'Unity', 'Vertex', 'Willow', 'Zenith'];
  const SUFFIX = ['Developments', 'Holdings', 'Group', 'Foods', 'Partners', 'Ventures', 'Properties', 'Brands', 'Labs'];
  const people = new Map<string, string>();
  const used = new Set<string>();
  seed.talents.forEach((t, i) => {
    let n = `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`;
    for (let k = 1; used.has(n); k++) n = `${FIRST[(i + k) % FIRST.length]} ${LAST[(i * 7 + k) % LAST.length]}`;
    used.add(n);
    people.set(t.name, n);
    t.name = n;
    t.initials = initialsOf(n);
    if (t.flag) t.flag.by = people.get(t.flag.by) ?? 'Team Member';
    if (t.utilOverride) t.utilOverride.by = people.get(t.utilOverride.by) ?? 'Team Member';
  });
  const clientMap = new Map<string, string>();
  seed.clients.forEach((c, i) => {
    const n = c.name.startsWith('Internal') ? c.name.replace(/\(.*\)/, '(Practice ' + (i % 5 + 1) + ')') : `${COMPANY[i % COMPANY.length]} ${SUFFIX[Math.floor(i / COMPANY.length) % SUFFIX.length]}`;
    clientMap.set(c.name, n);
    c.name = n;
    c.owner = people.get(c.owner) ?? 'Unassigned';
  });
  const engMap = new Map<string, string>();
  const engName = (real: string, client: string, scope: string) => {
    if (!engMap.has(real)) engMap.set(real, `${clientMap.get(client) ?? 'Client'} — ${scope} ${engMap.size + 1}`);
    return engMap.get(real)!;
  };
  seed.engagements.forEach((e) => {
    e.name = engName(e.name, e.client, e.scope);
    e.client = clientMap.get(e.client) ?? e.client;
    e.notes = '';
    e.customCps?.forEach((c) => { if (c.owner) c.owner = people.get(c.owner) ?? null; });
  });
  // Talent ids for history-only people were derived from real names; remap them.
  const newId = new Map<string, string>();
  seed.talents.forEach((t, i) => { if (t.id.startsWith('ta-')) { newId.set(t.id, 'ta-' + i); t.id = 'ta-' + i; } });
  const remap = (id: string) => newId.get(id) ?? id;
  seed.engagements.forEach((e) => {
    e.leadId = remap(e.leadId);
    e.teamIds = e.teamIds.map(remap);
    e.supervisorId = e.supervisorId ? remap(e.supervisorId) : null;
    e.allocationOverrides = Object.fromEntries(Object.entries(e.allocationOverrides).map(([k, v]) => [remap(k), v]));
  });
  seed.trajectory.forEach((r) => {
    r.talentId = r.talentId ? remap(r.talentId) : null;
    r.talent = people.get(r.talent) ?? r.talent;
    r.engagement = engName(r.engagement, r.client, r.scope);
    r.client = clientMap.get(r.client) ?? r.client;
  });
  seed.audit = (seed.audit ?? []).map((a) => ({ ...a, userName: people.get(a.userName) ?? 'Team Member', entityName: engMap.get(a.entityName) ?? people.get(a.entityName) ?? '', details: '' }));
  seed.description = 'Anonymized demo data — structure mirrors the real prototype, every name is fictional';
  return seed;
}

// ---- CLI ----
if (process.argv[1] && process.argv[1].endsWith('import-artifact.ts')) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--store' && args[args.indexOf(a) - 1] !== '--out');
  if (!file) {
    console.error('Usage: npm run import:artifact -- <artifact.html> [--store store.json] [--out seed.json] [--anonymize]');
    process.exit(1);
  }
  const opt = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const storePath = opt('--store');
  const out = opt('--out') ?? 'data/real-seed.json';
  const seed = seedFromArtifact(fs.readFileSync(file, 'utf8'), {
    store: storePath ? JSON.parse(fs.readFileSync(storePath, 'utf8')) : undefined,
    anonymize: args.includes('--anonymize'),
  });
  fs.writeFileSync(out, JSON.stringify(seed, null, 1));
  console.log(`Wrote ${out}: ${seed.talents.length} talents, ${seed.engagements.length} engagements, ${seed.clients.length} clients, ${seed.trajectory.length} trajectory rows, ${seed.audit?.length ?? 0} audit entries.`);
}
