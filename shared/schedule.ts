/* Critical Path Schedule (CPS), lifecycle progress, health and priority.
   All dates are handled in UTC so results are identical on the server and in any browser. */
import { LIFECYCLE, SCOPE_STAGES, type Scope, type StageDef, type StageId } from './constants.js';
import type { CpsStage, Engagement } from './types.js';

const DAY = 86_400_000;

export function parseDay(s: string): Date {
  return new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? s + 'T00:00:00Z' : s);
}
export function toDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}
export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY);
}

export function isKnownScope(scope: string): scope is Scope {
  return scope in SCOPE_STAGES;
}
export function scopeStages(scope: string): StageDef[] {
  if (!isKnownScope(scope)) return LIFECYCLE;
  const ids = SCOPE_STAGES[scope].ids;
  return LIFECYCLE.filter((s) => ids.includes(s.id));
}
export function stageDef(id: string): StageDef | undefined {
  return LIFECYCLE.find((s) => s.id === id);
}
export function stageLabel(id: string): string {
  return stageDef(id)?.label ?? id;
}

/** Stage weights re-normalised to 100 across the stages a scope actually runs. */
export function scopeWeights(scope: string): Partial<Record<StageId, number>> {
  const stages = scopeStages(scope);
  const sum = stages.reduce((s, st) => s + st.weight, 0);
  const out: Partial<Record<StageId, number>> = {};
  stages.forEach((st) => (out[st.id] = (st.weight / sum) * 100));
  return out;
}

export interface ScheduledStage {
  id: StageId;
  label: string;
  start: Date;
  end: Date;
  owner: string | null;
}

/** Auto-projected schedule: each stage gets its typical share of the engagement's duration. */
export function computeCps(start: string, end: string, scope: string): ScheduledStage[] {
  const stages = scopeStages(scope);
  const weights = scopeWeights(scope);
  const s = parseDay(start).getTime();
  const total = Math.max(1, parseDay(end).getTime() - s);
  let cum = 0;
  return stages.map((st) => {
    const from = cum;
    cum += weights[st.id] ?? 0;
    return { id: st.id, label: st.label, start: new Date(s + total * (from / 100)), end: new Date(s + total * (cum / 100)), owner: null };
  });
}

/** Progress % implied by the current stage within the engagement's scope. */
export function progressFor(scope: string, stage: string): number {
  const stages = scopeStages(scope);
  let idx = stages.findIndex((s) => s.id === stage);
  if (idx === -1) {
    // Stage manually set outside the scope's slice — fall back to the full lifecycle.
    idx = LIFECYCLE.findIndex((s) => s.id === stage);
    return Math.round(((idx + 1) / LIFECYCLE.length) * 100);
  }
  return Math.round(((idx + 1) / stages.length) * 100);
}

export interface ScheduleInfo {
  /** Stage dates — only from an uploaded CPS. Empty when no CPS has been uploaded (never estimated). */
  cps: ScheduledStage[];
  stages: StageDef[];
  start: Date;
  /** The CPS end, else the planned end date someone entered; null when neither is known. */
  end: Date | null;
  /** % of the time frame elapsed; null without a known end. */
  pctElapsed: number | null;
  daysLeft: number | null;
  closingSoon: boolean;
  isComplete: boolean;
  isCustomSchedule: boolean;
}

type ScheduleInput = Pick<Engagement, 'start' | 'end' | 'scope' | 'stage' | 'customCps'>;

/** The known time frame of an engagement. Nothing is projected: stage dates come only from an
    uploaded CPS, and the end only from the CPS or a planned end date someone actually entered. */
export function scheduleInfo(e: ScheduleInput, now: Date): ScheduleInfo | null {
  if (!e.start) return null;
  const stages = scopeStages(e.scope);
  const custom = !!e.customCps && e.customCps.length > 0;
  const cps: ScheduledStage[] = custom
    ? e.customCps!.map((c) => ({ id: c.id, label: c.label, start: parseDay(c.start), end: parseDay(c.end), owner: c.owner ?? null }))
    : [];
  const start = custom ? new Date(Math.min(parseDay(e.start).getTime(), ...cps.map((c) => c.start.getTime()))) : parseDay(e.start);
  const end = custom ? new Date(Math.max(...cps.map((c) => c.end.getTime()))) : e.end ? parseDay(e.end) : null;
  const pctElapsed = end ? Math.min(100, Math.max(0, ((now.getTime() - start.getTime()) / Math.max(1, end.getTime() - start.getTime())) * 100)) : null;
  const daysLeft = end ? Math.round((end.getTime() - now.getTime()) / DAY) : null;
  const last = stages[stages.length - 1];
  const isFinalStage = !!last && last.id === e.stage;
  const isComplete = isKnownScope(e.scope) && isFinalStage;
  const closingSoon = !isComplete && (e.stage === 'execution' || isFinalStage || (daysLeft !== null && daysLeft <= 14) || (pctElapsed !== null && pctElapsed >= 85));
  return { cps, stages, start, end, pctElapsed, daysLeft, closingSoon, isComplete, isCustomSchedule: custom };
}

/** The engagement's end as far as it is known (CPS end, else the entered end date). */
export function knownEnd(e: ScheduleInput): string | null {
  if (e.customCps && e.customCps.length) return e.customCps.map((c) => c.end).sort().pop()!;
  return e.end;
}

export type Health = 'Unscheduled' | 'Complete' | 'Delayed' | 'About to Close' | 'Just Opened' | 'Midway';
export const HEALTH_VALUES: Health[] = ['Just Opened', 'Midway', 'About to Close', 'Delayed', 'Complete'];

/** Health is computed from the stage and, when known, the time frame — never stored. */
export function health(e: ScheduleInput, now: Date): Health {
  const info = scheduleInfo(e, now);
  if (!info) return 'Unscheduled';
  if (info.isComplete) return 'Complete';
  if (info.daysLeft !== null && info.daysLeft < 0) return 'Delayed';
  if (info.closingSoon) return 'About to Close';
  if (info.pctElapsed !== null) return info.pctElapsed < 20 ? 'Just Opened' : 'Midway';
  // No time frame: judge by stage alone.
  return info.stages.findIndex((s) => s.id === e.stage) <= 0 ? 'Just Opened' : 'Midway';
}

export type Priority = 'High' | 'Medium' | 'Low';

/** High = overdue or only a lead assigned; Medium = closing or midway; Low = freshly opened and staffed. */
export function priority(e: ScheduleInput & Pick<Engagement, 'teamIds'>, now: Date): Priority {
  const h = health(e, now);
  if (h === 'Delayed' || e.teamIds.length <= 1) return 'High';
  if (h === 'Just Opened') return 'Low';
  return 'Medium';
}

/** Parse a weekly CPS upload: `Activity, Start Week, End Week[, Task Owner]` with a header row.
    Weeks are counted from the engagement start date. */
export function parseCpsCsv(text: string, scope: string, engagementStart: string): { parsed: CpsStage[]; unmatched: string[] } {
  const stages = scopeStages(scope);
  const start = parseDay(engagementStart);
  const parsed: CpsStage[] = [];
  const unmatched: string[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(1);
  for (const line of lines) {
    const parts = splitCsvLine(line);
    if (parts.length < 3) continue;
    const [label, sw, ew, owner] = parts;
    const stage = stages.find((s) => s.label.toLowerCase() === label.toLowerCase());
    if (!stage) {
      unmatched.push(label);
      continue;
    }
    const startWeek = parseInt(sw.replace(/[^\d]/g, ''), 10);
    const endWeek = parseInt(ew.replace(/[^\d]/g, ''), 10);
    if (!startWeek || !endWeek || endWeek < startWeek) continue;
    parsed.push({
      id: stage.id,
      label: stage.label,
      start: toDay(addDays(start, (startWeek - 1) * 7)),
      end: toDay(addDays(start, endWeek * 7)),
      startWeek,
      endWeek,
      owner: owner?.trim() ? owner.trim() : null,
    });
  }
  return { parsed, unmatched };
}

export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

export function toCsv<T extends object>(rows: T[], cols: (keyof T & string)[]): string {
  const esc = (v: unknown) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}
