/* Engagement Updates Meeting — one list of the engagements (like Engagement Status), where every
   project shows its full team, its key milestones, its own notes box for today's session, and the
   notes from earlier sessions. The meeting questions are shown once, at the top, as a reference. */
import { useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { progressFor, scopeStages, stageLabel, toCsv, toDay, type ScheduleInfo } from '../../../shared/schedule';
import type { Engagement, MeetingNote, MeetingRag, Milestone, MilestoneStatus } from '../../../shared/types';
import type { Model } from '../../../shared/engine';
import { Donut } from '../components/charts';
import { ClientModal, EngagementModal, TalentModal } from '../components/modals';
import { Avatar, Card, Confirm, Empty, ModalFrame, PageHead, fmtDate, useModal, useToast } from '../components/ui';
import { api } from '../lib/api';
import { noteText, staffOf, useMeetingData } from '../lib/meetings';
import { NotesReportIcon, RecapModal } from '../components/RecapModal';
import { NoteItem, RAG, RagPicker } from '../components/MeetingNote';
import { useWorkspace } from '../lib/workspace';

const MS: Record<MilestoneStatus, { label: string; color: string; icon: string }> = {
  planned: { label: 'Planned', color: 'var(--text-faint)', icon: '○' },
  'in-progress': { label: 'In progress', color: 'var(--accent)', icon: '◐' },
  done: { label: 'Done', color: 'var(--ok)', icon: '✓' },
  delayed: { label: 'Delayed', color: 'var(--danger)', icon: '!' },
};
export const MEETING_QUESTIONS = [
  { icon: '📍', q: 'Where are we now?', hint: 'What was delivered since the last session; which milestone we are at.' },
  { icon: '⚠️', q: 'Are there any challenges?', hint: 'Risks, blockers, client issues, resourcing.' },
  { icon: '➡️', q: 'What are the next steps?', hint: 'What happens before the next session.' },
  { icon: '👥', q: 'Who does what from the team?', hint: 'Owner and due date for each next step.' },
  { icon: '🏁', q: 'Are we on track against the key milestones?', hint: 'Any milestone to add, move or close.' },
];
const today = () => new Date().toISOString().slice(0, 10);
const daysSince = (d: string) => Math.floor((Date.parse(today()) - Date.parse(d)) / 86_400_000);
const STALE_DAYS = 14;


function Ring({ pct, color, size = 48, stroke = 5, children }: { pct: number; color: string; size?: number; stroke?: number; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="mtg-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${(c * Math.max(0, Math.min(100, pct))) / 100} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <div className="mtg-ring-label">{children ?? `${Math.round(pct)}%`}</div>
    </div>
  );
}


// ---------- visuals ----------
/** The engagement's lifecycle as a segmented bar: done, current, still to come. */
function JourneyBar({ e }: { e: Engagement }) {
  const stages = scopeStages(e.scope);
  const at = Math.max(0, stages.findIndex((x) => x.id === e.stage));
  return (
    <div className="mtg-journey" aria-label={`Stage ${at + 1} of ${stages.length}: ${stageLabel(e.stage)}`}>
      <div className="mtg-journey-bar">
        {stages.map((x, i) => (
          <div key={x.id} className={'mtg-journey-seg' + (i < at ? ' done' : i === at ? ' now' : '')} title={`${i + 1}. ${x.label}`} style={{ flex: x.weight }}>
            {i === at && <span className="mtg-journey-pin">{x.icon}</span>}
          </div>
        ))}
      </div>
      <div className="mtg-journey-legend"><span>Stage {at + 1} of {stages.length}</span><b>{stageLabel(e.stage)}</b><span>{stages[stages.length - 1].label}</span></div>
    </div>
  );
}

/** Status of each session, oldest to newest. */
function StatusTrend({ notes }: { notes: MeetingNote[] }) {
  const list = [...notes].slice(0, 8).reverse();
  return (
    <div className="mtg-trend" title="Status at each session, oldest → newest">
      {list.length ? list.map((n, i) => <i key={n.id} className={i === list.length - 1 ? 'last' : ''} style={{ background: RAG[n.rag].color }} title={`${fmtDate(n.date)} · ${RAG[n.rag].label}`} />)
        : <span className="muted">no sessions</span>}
    </div>
  );
}

function MiniStat({ value, label, color, children, onClick }: { value: ReactNode; label: string; color?: string; children?: ReactNode; onClick?: () => void }) {
  return (
    <div className={'mtg-mini' + (onClick ? ' clickable' : '')} onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined} onKeyDown={(x) => onClick && x.key === 'Enter' && onClick()}>
      <div className="mtg-mini-v" style={color ? { color } : undefined}>{value}</div>
      <div className="mtg-mini-l">{label}</div>
      {children}
    </div>
  );
}

/** The CPS time frame, drawn automatically once a CPS is uploaded: each stage on its dates
    (parallel stages on their own lane), a "today" line, and how much time is left. */
function TimeFrame({ info, children, onOpen }: { info: ScheduleInfo; children?: ReactNode; onOpen?: () => void }) {
  const t = Date.parse(today());
  const cpsStart = Math.min(...info.cps.map((c) => c.start.getTime()));
  const cpsEnd = info.end!.getTime();
  const min = Math.min(cpsStart, t);
  const max = Math.max(cpsEnd, t);
  const elapsed = Math.round(Math.min(100, Math.max(0, ((t - cpsStart) / Math.max(1, cpsEnd - cpsStart)) * 100)));
  const pos = (ms: number) => ((ms - min) / Math.max(1, max - min)) * 100;
  const lanes: number[] = [];
  const placed = [...info.cps].sort((a, b) => a.start.getTime() - b.start.getTime()).map((c) => {
    let lane = lanes.findIndex((endAt) => endAt < c.start.getTime());
    if (lane < 0) { lane = lanes.length; lanes.push(0); }
    lanes[lane] = c.end.getTime();
    return { c, lane, state: c.end.getTime() < t ? 'done' : c.start.getTime() <= t ? 'now' : 'next' };
  });
  const now = placed.filter((x) => x.state === 'now').map((x) => x.c.label);
  const left = info.daysLeft;
  return (
    <div className="mtg-tf">
      <div className="mtg-tf-head">
        <button type="button" className="mtg-label mtg-link-inline" title="Open the schedule (CPS)" onClick={onOpen}>📤 Time frame · from the uploaded CPS ↗</button>
        <span className="mtg-tf-left" style={{ color: left !== null && left < 0 ? 'var(--danger)' : left !== null && left <= 14 ? '#F0A54A' : 'var(--lavender)' }}>
          {left === null ? '' : left < 0 ? `${-left} days past the CPS end` : `${left} days left`} · {elapsed}% of the CPS time elapsed
        </span>
      </div>
      <div className="mtg-gantt" style={{ height: lanes.length * 16 + 2 }}>
        {placed.map(({ c, lane, state }) => (
          <div key={c.id + c.start.getTime()} className={'mtg-gantt-seg ' + state} onClick={onOpen} title={`${c.label} · ${fmtDate(c.start)} → ${fmtDate(c.end)}`}
            style={{ left: pos(c.start.getTime()) + '%', width: `max(6px, ${pos(c.end.getTime() + 86_400_000) - pos(c.start.getTime())}%)`, top: lane * 16 }}>
            <span>{c.label}</span>
          </div>
        ))}
        <div className="mtg-gantt-today" style={{ left: pos(t) + '%' }}><span>Today</span></div>
      </div>
      <div className="mtg-tf-foot"><span>{fmtDate(new Date(cpsStart))}</span><b>{now.length ? `Now: ${now.join(' · ')}` : placed.every((x) => x.state === 'done') ? 'All CPS stages complete' : 'Between stages'}</b><span>{fmtDate(info.end!)}</span></div>
      {children}
    </div>
  );
}

/** Milestones placed on a line by date, with a "today" marker. */
function MilestoneTrack({ list, onPick, bounds }: { list: Milestone[]; onPick?: (m: Milestone) => void; bounds?: [number, number] }) {
  const dated = list.filter((x) => x.date);
  if (!dated.length) return null;
  const t = today();
  const times = [...dated.map((x) => Date.parse(x.date!)), Date.parse(t), ...(bounds ?? [])];
  const min = Math.min(...times);
  const max = Math.max(...times);
  const pos = (d: string) => (max === min ? 50 : bounds ? ((Date.parse(d) - min) / (max - min)) * 100 : 3 + ((Date.parse(d) - min) / (max - min)) * 94);
  return (
    <div className="mtg-track">
      <div className="mtg-track-line" />
      <div className="mtg-track-fill" style={{ width: pos(t) + '%' }} />
      {!bounds && <div className="mtg-today" style={{ left: pos(t) + '%' }}><span>Today</span></div>}
      {dated.map((x, i) => {
        const p = pos(x.date!);
        return (
          <button key={x.id} type="button" className="mtg-dot" disabled={!onPick} style={{ left: p + '%', background: MS[x.status].color }}
            title={`${x.title} · ${fmtDate(x.date!)} · ${MS[x.status].label}`} onClick={() => onPick?.(x)}>
            <span className={'mtg-dot-label ' + (i % 2 ? 'down' : 'up') + (p < 15 ? ' edge-l' : p > 85 ? ' edge-r' : '')}><b>{x.title}</b><br />{fmtDate(x.date!, { day: '2-digit', month: 'short' })}</span>
          </button>
        );
      })}
    </div>
  );
}

// ---------- page ----------
export default function Meetings() {
  const { model: m, canEdit } = useWorkspace();
  const modal = useModal();
  const { notesFor, milestonesFor } = useMeetingData();
  const [params, setParams] = useSearchParams();
  const [session, setSession] = useState(today());
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'attention' | 'name' | 'lead' | 'sector'>('attention');
  const [scope, setScope] = useState<'active' | 'archive'>('active');
  const [status, setStatus] = useState<MeetingRag | 'none' | ''>(() => {
    const v = new URLSearchParams(window.location.search).get('status');
    return v === 'on-track' || v === 'at-risk' || v === 'off-track' || v === 'none' ? v : '';
  });
  const [focus, setFocus] = useState<'' | 'uncovered' | 'covered' | 'overdue'>('');

  const active = m.engagements.filter((e) => m.bucket(e) === 'active');
  const list = scope === 'active' ? active : m.engagements.filter((e) => m.bucket(e) !== 'active' && e.status !== 'deleted' && notesFor(e.id).length > 0);
  const rows = list.filter((e) => (!q || `${e.name} ${e.client} ${staffOf(e).map((id) => m.name(id)).join(' ')}`.toLowerCase().includes(q.toLowerCase()))
    && (!status || (status === 'none' ? !notesFor(e.id).length : notesFor(e.id)[0]?.rag === status))
    && (!focus || (focus === 'overdue' ? milestonesFor(e.id).some((x) => x.status !== 'done' && !!x.date && x.date < today())
      : (focus === 'covered') === notesFor(e.id).some((n) => n.date === session))));
  // Sort once on load / when the sort changes, so a card doesn't jump away while its notes are being typed.
  const [order, setOrder] = useState<string[]>([]);
  const attention = (e: Engagement) => {
    const last = notesFor(e.id)[0];
    if (!last) return 0;
    return (last.rag === 'off-track' ? 1 : last.rag === 'at-risk' ? 2 : 4) + (daysSince(last.date) > STALE_DAYS ? 0 : 1);
  };
  useEffect(() => {
    setOrder([...list].sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name)
      : sort === 'lead' ? m.name(a.leadId).localeCompare(m.name(b.leadId)) || a.name.localeCompare(b.name)
        : sort === 'sector' ? a.sector.localeCompare(b.sector) || a.name.localeCompare(b.name)
          : attention(a) - attention(b) || a.name.localeCompare(b.name))).map((e) => e.id));
  }, [sort, scope, list.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const rank = new Map(order.map((id, i) => [id, i]));
  const sorted = [...rows].sort((a, b) => (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999));

  // A project's full view (?e=<id>); the main page lists all of them.
  const target = params.get('e');
  const open = (id: string | null, editNote?: string) => { setParams(id ? { e: id, ...(editNote ? { edit: editNote } : {}) } : {}); if (!editNote) window.scrollTo({ top: 0 }); };
  const editId = params.get('edit');
  const doneEditing = () => { if (target) setParams({ e: target }, { replace: true }); };
  const [returnTo, setReturnTo] = useState<string | null>(null);
  useEffect(() => {
    if (!target && returnTo) { document.getElementById('mtg-row-' + returnTo)?.scrollIntoView({ block: 'center' }); setReturnTo(null); }
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps
  // The two boxes at the top can be folded (remembered on this device); on phones the questions start folded.
  const [fold, setFold] = useState<{ questions: boolean; status: boolean }>(() => {
    try { const v = JSON.parse(localStorage.getItem('eeos.meetingFold') ?? 'null'); if (v) return v; } catch { /* private mode */ }
    return { questions: window.innerWidth < 860, status: false };
  });
  const flip = (k: 'questions' | 'status') => setFold((f) => {
    const next = { ...f, [k]: !f[k] };
    try { localStorage.setItem('eeos.meetingFold', JSON.stringify(next)); } catch { /* private mode */ }
    return next;
  });
  const recapBtn = (only?: string) => (
    <button className="btn btn-sm mtg-recap-btn" title="Preview and export a one-page TBC-branded PDF of this session's notes"
      onClick={() => modal.open(<RecapModal session={session} only={only} notesFor={notesFor} order={sorted.map((x) => x.id)} />)}><NotesReportIcon /> Notes report</button>
  );
  const sessionPicker = <label className="mtg-session-pick">🗓 Session date <input type="date" value={session} max="2100-12-31" onChange={(x) => x.target.value && setSession(x.target.value)} /></label>;

  if (target) {
    const e = m.engagement(target);
    if (!e || e.status === 'deleted') return <Card><Empty>That engagement can’t be found. <button className="btn btn-sm" onClick={() => open(null)}>← All engagements</button></Empty></Card>;
    const nav = sorted.some((x) => x.id === e.id) ? sorted : [e];
    const idx = nav.findIndex((x) => x.id === e.id);
    return (
      <>
        <div className="mtg-detail-nav">
          <button className="btn btn-sm" onClick={() => { setReturnTo(e.id); open(null); }}>← All engagements</button>
          <div className="row" style={{ gap: 6 }}>
            <button className="btn btn-sm" disabled={idx <= 0} onClick={() => open(nav[idx - 1].id)}>‹ Previous</button>
            <span className="small muted">{idx + 1} of {nav.length}</span>
            <button className="btn btn-sm btn-primary" disabled={idx >= nav.length - 1} onClick={() => open(nav[idx + 1].id)}>Next ›</button>
          </div>
          <div className="mtg-head-tools">{recapBtn(e.id)}{sessionPicker}</div>
        </div>
        <div className="mtg-qstrip">
          <span className="mtg-label">Questions</span>
          {MEETING_QUESTIONS.map((x) => <span key={x.q} className="mtg-qchip" title={x.hint}>{x.icon} {x.q}</span>)}
        </div>
        <ProjectCard e={e} m={m} session={session} notes={notesFor(e.id)} milestones={milestonesFor(e.id)} canWrite={canEdit && m.bucket(e) === 'active'} full editId={editId} onEdited={doneEditing} />
      </>
    );
  }

  const lasts = active.map((e) => notesFor(e.id)[0]);
  const thisSession = active.filter((e) => notesFor(e.id).some((n) => n.date === session)).length;
  const ragCount = (r: MeetingRag) => lasts.filter((n) => n?.rag === r).length;
  const noUpdate = lasts.filter((n) => !n).length;
  const openMs = active.flatMap((e) => milestonesFor(e.id)).filter((x) => x.status !== 'done' && x.date);
  const msLate = openMs.filter((x) => x.date! < today()).length;
  const msSoon = openMs.filter((x) => x.date! >= today() && daysSince(x.date!) >= -14).length;

  return (
    <>
      <PageHead title="Engagement Updates Meeting" desc="All active engagements at a glance. Click an engagement to open its full view: team, time frame, milestones, this session’s notes and earlier sessions.">
        <div className="mtg-head-tools">{recapBtn()}{sessionPicker}</div>
      </PageHead>

      <div className="mtg-top">
        <div className={'card mtg-questions' + (fold.questions ? ' folded' : '')}>
          <button type="button" className="mtg-fold-head" aria-expanded={!fold.questions} onClick={() => flip('questions')}>
            <span className="mtg-questions-title">Questions to cover for each engagement</span><span className="mtg-fold-btn">{fold.questions ? '+ Show' : '− Hide'}</span>
          </button>
          {fold.questions ? (
            <div className="mtg-q-mini">{MEETING_QUESTIONS.map((x) => <span key={x.q} title={x.q}>{x.icon}</span>)}</div>
          ) : (
            <ol>
              {MEETING_QUESTIONS.map((x) => <li key={x.q}><span className="mtg-qi">{x.icon}</span><div><b>{x.q}</b><small>{x.hint}</small></div></li>)}
            </ol>
          )}
        </div>
        <div className={'card mtg-pulse-card' + (fold.status ? ' folded' : '')}>
          <button type="button" className="mtg-fold-head" aria-expanded={!fold.status} onClick={() => flip('status')}>
            <span className="mtg-pulse-title">Portfolio status {!fold.status && <span className="muted">· click a colour to filter</span>}</span><span className="mtg-fold-btn">{fold.status ? '+ Show' : '− Hide'}</span>
          </button>
          {fold.status ? (
            <div className="mtg-legend">{(['on-track', 'at-risk', 'off-track'] as MeetingRag[]).map((r) => <span key={r}><i style={{ background: RAG[r].color }} />{RAG[r].label} <b>{ragCount(r)}</b></span>)}<span><i style={{ background: 'var(--border)' }} />No notes <b>{noUpdate}</b></span><span>· Covered <b>{thisSession}/{active.length}</b></span></div>
          ) : <>
          <Donut size={132} onPick={(k) => setStatus(status === k ? '' : (k as MeetingRag | 'none'))} buckets={[
            ...(['on-track', 'at-risk', 'off-track'] as MeetingRag[]).map((r) => ({ key: r, label: RAG[r].label, count: ragCount(r), color: RAG[r].color })),
            { key: 'none', label: 'No notes yet', count: noUpdate, color: '#3A4366' },
          ]} />
          <div className="mtg-pulse-stats">
            <div className={'mtg-pulse-row clickable' + (focus === 'uncovered' ? ' on' : '')} role="button" tabIndex={0} title="Show the engagements still to cover this session"
              onClick={() => setFocus(focus === 'uncovered' ? '' : 'uncovered')} onKeyDown={(x) => x.key === 'Enter' && setFocus(focus === 'uncovered' ? '' : 'uncovered')}>
              <Ring pct={active.length ? (thisSession / active.length) * 100 : 0} color="var(--accent)" size={54} stroke={6}><b>{thisSession}</b><small>/{active.length}</small></Ring>
              <div><div className="mtg-pulse-title">Covered this session</div><div className="mtg-pulse-sub">{fmtDate(session)}</div></div>
            </div>
            <div className={'mtg-pulse-row clickable' + (focus === 'overdue' ? ' on' : '')} role="button" tabIndex={0} title="Show the engagements with an overdue milestone"
              onClick={() => setFocus(focus === 'overdue' ? '' : 'overdue')} onKeyDown={(x) => x.key === 'Enter' && setFocus(focus === 'overdue' ? '' : 'overdue')}>
              <div className="mtg-big" style={{ color: msLate ? 'var(--danger)' : 'var(--ok)' }}>{msLate}</div>
              <div><div className="mtg-pulse-title">Milestones overdue</div><div className="mtg-pulse-sub">{msSoon} due in the next 14 days</div></div>
            </div>
          </div>
          </>}
        </div>
      </div>

      <div className="filters-bar">
        <input type="text" placeholder="Search engagement, client or team member…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
          <option value="attention">Sort: needs attention first</option><option value="lead">Sort: engagement leader (A–Z)</option><option value="sector">Sort: sector (A–Z)</option><option value="name">Sort: engagement name (A–Z)</option>
        </select>
        <select value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
          <option value="active">Active engagements ({active.length})</option><option value="archive">Archive: closed engagements with notes</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="">Any status</option>{(Object.keys(RAG) as MeetingRag[]).map((r) => <option key={r} value={r}>{RAG[r].label}</option>)}<option value="none">No notes yet</option>
        </select>
        <select value={focus} onChange={(e) => setFocus(e.target.value as typeof focus)}>
          <option value="">This session: all</option><option value="uncovered">Still to cover this session</option><option value="covered">Covered this session</option><option value="overdue">With an overdue milestone</option>
        </select>
        {(q || status || focus) && <button className="btn btn-ghost btn-sm" onClick={() => { setQ(''); setStatus(''); setFocus(''); }}>✕ Clear filters</button>}
      </div>

      {sorted.length ? (
        <div className="mtg-list compact">
          {sorted.map((e, i) => {
            const group = sort === 'lead' ? m.name(e.leadId) : sort === 'sector' ? e.sector : null;
            const prev = i > 0 ? (sort === 'lead' ? m.name(sorted[i - 1].leadId) : sorted[i - 1].sector) : null;
            const count = group === null ? 0 : sorted.filter((x) => (sort === 'lead' ? m.name(x.leadId) : x.sector) === group).length;
            return (
              <div key={e.id} className="mtg-list-item">
                {group !== null && group !== prev && <div className="mtg-group">{sort === 'lead' ? '👑' : '🏢'} {group}<span>{count} engagement{count === 1 ? '' : 's'}</span></div>}
                <ProjectRow e={e} m={m} session={session} notes={notesFor(e.id)} milestones={milestonesFor(e.id)} onOpen={() => open(e.id)} onEditNote={(nid) => open(e.id, nid)} />
              </div>
            );
          })}
        </div>
      ) : <Card><Empty>{scope === 'active' ? 'No active engagements match.' : 'No closed engagements have notes yet.'}</Empty></Card>}
    </>
  );
}

/** CPS stages as milestones (status from their dates), so a CPS needs no typing. */
function cpsMilestones(e: Engagement, info: ScheduleInfo | null): Milestone[] {
  const t = today();
  return (info?.cps ?? []).map((c) => ({
    id: 'cps-' + c.id, engagementId: e.id, title: c.label, date: toDay(c.end), createdAt: '', updatedAt: '',
    status: toDay(c.end) < t ? 'done' : toDay(c.start) <= t ? 'in-progress' : 'planned',
  }));
}

/** A one-line time frame for the list: CPS stages on their dates, or the lifecycle stages. */
function SlimTime({ e, info }: { e: Engagement; info: ScheduleInfo | null }) {
  if (info?.cps.length) {
    const t = Date.parse(today());
    const a = Math.min(...info.cps.map((c) => c.start.getTime()));
    const b = info.end!.getTime();
    const min = Math.min(a, t);
    const max = Math.max(b, t);
    const pos = (ms: number) => ((ms - min) / Math.max(1, max - min)) * 100;
    const left = Math.round((b - t) / 86_400_000);
    return (
      <div className="mtg-slim" title="Time frame from the uploaded CPS">
        <div className="mtg-slim-bar">
          {info.cps.map((c) => {
            const st = c.end.getTime() < t ? 'done' : c.start.getTime() <= t ? 'now' : 'next';
            return <i key={c.id + c.start.getTime()} className={st} style={{ left: pos(c.start.getTime()) + '%', width: `max(3px, ${pos(c.end.getTime() + 86_400_000) - pos(c.start.getTime())}%)` }} title={`${c.label} · ${fmtDate(c.start)} → ${fmtDate(c.end)}`} />;
          })}
          <b style={{ left: pos(t) + '%' }} />
        </div>
        <div className="mtg-slim-l"><span>📤 CPS</span><span style={{ color: left < 0 ? 'var(--danger)' : left <= 14 ? '#F0A54A' : undefined }}>{left < 0 ? `${-left}d past end` : `${left}d left`}</span></div>
      </div>
    );
  }
  const stages = scopeStages(e.scope);
  const at = Math.max(0, stages.findIndex((x) => x.id === e.stage));
  return (
    <div className="mtg-slim" title="Lifecycle stage (no CPS uploaded)">
      <div className="mtg-slim-steps">{stages.map((x, i) => <i key={x.id} className={i < at ? 'done' : i === at ? 'now' : ''} style={{ flex: x.weight }} />)}</div>
      <div className="mtg-slim-l"><span>Stage {at + 1}/{stages.length}</span><span className="muted">No CPS</span></div>
    </div>
  );
}

/** One engagement in the overview list. Click → its full view. */
/** Run a click without also triggering the row/card it sits in. */
const own = (fn: () => void) => (x: { stopPropagation: () => void }) => { x.stopPropagation(); fn(); };
const clientId = (m: Model, name: string) => m.clients().find((c) => c.name === name)?.id;

function ProjectRow({ e, m, session, notes, milestones, onOpen, onEditNote }: { e: Engagement; m: Model; session: string; notes: MeetingNote[]; milestones: Milestone[]; onOpen: () => void; onEditNote: (noteId: string) => void }) {
  const modal = useModal();
  const last = notes[0];
  const rag = last ? RAG[last.rag] : null;
  const info = m.schedule(e);
  const staff = staffOf(e);
  const others = staff.filter((x) => x !== e.leadId);
  const all = [...cpsMilestones(e, info?.cps.length ? info : null), ...milestones];
  const done = all.filter((x) => x.status === 'done').length;
  const late = all.some((x) => x.status !== 'done' && x.date && x.date < today());
  const covered = notes.some((n) => n.date === session);
  const snippet = last ? noteText(last).map((p) => p.text).join(' · ').replace(/\s+/g, ' ') : '';
  return (
    <div role="button" tabIndex={0} id={'mtg-row-' + e.id} className="mtg-row" onClick={onOpen} onKeyDown={(x) => { if (x.key === 'Enter') onOpen(); }}
      title="Open the full view" style={{ ['--rag' as string]: rag?.color ?? 'var(--border)' }}>
      <Ring pct={last?.progress ?? progressFor(e.scope, e.stage)} color={rag?.color ?? 'var(--accent)'} size={42} stroke={4} />
      <div className="mtg-row-main">
        <div className="mtg-row-name">{e.name}</div>
        <div className="mtg-row-sub">
          {clientId(m, e.client) ? <button type="button" className="mtg-link-inline" title="Open the client" onClick={own(() => modal.open(<ClientModal id={clientId(m, e.client)!} />))}>{e.client}</button> : e.client} · {e.sector} · {stageLabel(e.stage)}
        </div>
      </div>
      <div className="mtg-row-team">
        <button type="button" className="mtg-row-lead mtg-link-inline" title="Open the leader's profile" onClick={own(() => modal.open(<TalentModal id={e.leadId} />))}>👑 {m.name(e.leadId)}</button>
        <div className="mtg-stack">
          {others.slice(0, 6).map((id) => <button type="button" key={id} className="mtg-face" title={`${m.name(id)} · ${m.talentById.get(id)?.title ?? ''}`} onClick={own(() => modal.open(<TalentModal id={id} />))}><Avatar text={m.talentById.get(id)?.initials ?? '?'} size={22} /></button>)}
          {others.length > 6 && <span className="mtg-stack-more">+{others.length - 6}</span>}
          <span className="mtg-row-count">{staff.length} people</span>
        </div>
      </div>
      <SlimTime e={e} info={info} />
      <div className="mtg-row-ms">
        <div className="mtg-row-msv" style={{ color: late ? 'var(--danger)' : undefined }}>{all.length ? `${done}/${all.length}` : '—'}</div>
        <div className="mtg-row-msl">{late ? 'milestone late' : 'milestones'}</div>
      </div>
      <div className="mtg-row-status">
        <span className="mtg-rag-pill" style={{ background: rag?.color ?? 'var(--border)' }}>{rag ? rag.label : 'No notes'}</span>
        <StatusTrend notes={notes} />
      </div>
      <div className="mtg-row-last">
        <div className="mtg-row-when">{covered ? <span style={{ color: 'var(--ok)' }}>✓ Notes this session</span> : last ? `Last notes ${fmtDate(last.date, { day: '2-digit', month: 'short' })}` : 'No notes yet'}</div>
        {snippet && <button type="button" className="mtg-row-snip mtg-link-inline" title="Click to edit this note" onClick={own(() => onEditNote(last!.id))}>✏️ {snippet}</button>}
      </div>
      <span className="mtg-row-go" aria-hidden="true">›</span>
    </div>
  );
}

// ---------- one engagement ----------
function ProjectCard({ e, m, session, notes, milestones, canWrite, full, editId, onEdited }: { e: Engagement; m: Model; session: string; notes: MeetingNote[]; milestones: Milestone[]; canWrite: boolean; full?: boolean; editId?: string | null; onEdited?: () => void }) {
  const { canEdit } = useWorkspace();
  const modal = useModal();
  const last = notes[0];
  const rag = last ? RAG[last.rag] : null;
  const pct = last?.progress ?? progressFor(e.scope, e.stage);
  const role = (pid: string) => (pid === e.leadId ? 'lead' : pid === e.supervisorId ? 'sup' : m.talentById.get(pid)?.department === 'Operations' ? 'ops' : 'member');
  const roleLabel = { lead: '👑 Leader', sup: '🧭 Supervisor', ops: '⚙️ Operations', member: '' };
  // With a CPS uploaded, its stages are milestones too (status from their dates) — nothing to type in.
  const info = m.schedule(e);
  const cps = info?.cps.length ? info : null;
  const t = today();
  const autoMs = cpsMilestones(e, cps);
  const allMs = [...autoMs, ...milestones];
  const msDone = allMs.filter((x) => x.status === 'done').length;
  const nextMs = allMs.filter((x) => x.status !== 'done' && x.date).sort((a, b) => a.date!.localeCompare(b.date!))[0];
  const jump = (part: string) => document.getElementById(`mtg-${part}-${e.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const editMs = canEdit ? (x: Milestone) => modal.open(<MilestoneModal engagementId={e.id} milestone={x} />) : undefined;
  const nextIn = nextMs ? -daysSince(nextMs.date!) : null;

  return (
    <div id={'mtg-' + e.id} className="card mtg-project" style={{ ['--rag' as string]: rag?.color ?? 'var(--border)' }}>
      <div className="mtg-project-head">
        <Ring pct={pct} color={rag?.color ?? 'var(--accent)'} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <button type="button" className="mtg-project-name mtg-link-inline" title="Open the engagement details" onClick={() => modal.open(<EngagementModal id={e.id} />)}>{e.name} <span className="mtg-ext">↗</span></button>
          <div className="mtg-project-meta">
            {clientId(m, e.client) ? <button type="button" className="mtg-link-inline" title="Open the client" onClick={() => modal.open(<ClientModal id={clientId(m, e.client)!} />)}>{e.client}</button> : e.client} · {e.sector} · {e.scope}
          </div>
        </div>
        <div className="mtg-head-right">
          <span className="mtg-rag-pill" style={{ background: rag?.color ?? 'var(--border)' }}>{rag ? rag.label : 'No notes yet'}</span>
          <StatusTrend notes={notes} />
        </div>
      </div>

      {cps ? (
        <TimeFrame info={cps} onOpen={() => modal.open(<EngagementModal id={e.id} initialTab="schedule" />)}>
          <MilestoneTrack list={milestones} onPick={editMs} bounds={[Math.min(...cps.cps.map((c) => c.start.getTime()), Date.parse(t)), Math.max(cps.end!.getTime(), Date.parse(t))]} />
        </TimeFrame>
      ) : (
        <>
          <div role="button" tabIndex={0} className="mtg-clickable" title="Open the lifecycle & schedule" onClick={() => modal.open(<EngagementModal id={e.id} initialTab="schedule" />)}><JourneyBar e={e} /></div>
          <div className="mtg-tf-hint">{info?.end ? `Planned end ${fmtDate(info.end)} · ${info.daysLeft! < 0 ? `${-info.daysLeft!} days past` : `${info.daysLeft} days left`} — ` : ''}No CPS uploaded yet: once a CPS is attached to the engagement, its time frame appears here automatically.
            {canEdit && <> <button type="button" className="mtg-link-btn" onClick={() => modal.open(<EngagementModal id={e.id} initialTab="schedule" />)}>📤 Upload CPS</button></>}</div>
        </>
      )}

      <div className="mtg-minis">
        <MiniStat value={notes.length} label={notes.length === 1 ? 'session' : 'sessions'} onClick={() => jump('hist')} />
        <MiniStat onClick={() => jump('hist')} value={last ? (daysSince(last.date) <= 0 ? 'Today' : `${daysSince(last.date)}d`) : '—'} label="since last update"
          color={!last ? 'var(--text-faint)' : daysSince(last.date) > STALE_DAYS ? '#F0A54A' : 'var(--ok)'} />
        <MiniStat onClick={() => jump('ms')} value={`${msDone}/${allMs.length}`} label={cps ? 'milestones done (incl. CPS)' : 'milestones done'}>
          <div className="mtg-mini-bar"><div style={{ width: (allMs.length ? (msDone / allMs.length) * 100 : 0) + '%' }} /></div>
        </MiniStat>
        <MiniStat onClick={() => (nextMs?.id.startsWith('cps-') || !nextMs ? modal.open(<EngagementModal id={e.id} initialTab="schedule" />) : modal.open(<MilestoneModal engagementId={e.id} milestone={nextMs} />))} value={nextMs ? (nextIn! < 0 ? `${-nextIn!}d late` : nextIn === 0 ? 'Today' : `in ${nextIn}d`) : '—'} label={nextMs ? `next: ${nextMs.title}` : 'no upcoming milestone'}
          color={nextMs ? (nextIn! < 0 ? 'var(--danger)' : nextIn! <= 7 ? '#F0A54A' : 'var(--lavender)') : 'var(--text-faint)'} />
        <MiniStat onClick={() => modal.open(<EngagementModal id={e.id} initialTab="team" />)} value={staffOf(e).length} label={`people · ${staffOf(e).filter((id) => m.talentById.get(id)?.department === 'Operations').length} Ops`} />
      </div>

      <div className="mtg-team">
        {staffOf(e).map((pid) => {
          const t = m.talentById.get(pid);
          const r = role(pid);
          return (
            <button type="button" key={pid} className={'mtg-member ' + r} title={`Open ${m.name(pid)}'s profile`} onClick={() => modal.open(<TalentModal id={pid} />)}>
              <Avatar text={t?.initials ?? '?'} size={26} />
              <div style={{ minWidth: 0 }}>
                <div className="mtg-member-name">{m.name(pid)}</div>
                <div className="mtg-member-role">{roleLabel[r] || t?.title}</div>
              </div>
            </button>
          );
        })}
      </div>

      {!cps && <MilestoneTrack list={milestones} onPick={editMs} />}
      <div className="mtg-milestones" id={'mtg-ms-' + e.id}>
        <span className="mtg-label">🏁 Key milestones</span>
        {milestones.some((x) => x.date) && (Object.keys(MS) as MilestoneStatus[]).map((k) => <span key={k} className="mtg-ms-legend"><i style={{ background: MS[k].color }} />{MS[k].label}</span>)}
        {milestones.filter((x) => !x.date).map((x) => (
          <button key={x.id} type="button" className="mtg-ms-chip" style={{ ['--ms' as string]: MS[x.status].color }} disabled={!canEdit}
            title={`${MS[x.status].label}${canEdit ? ' — click to edit' : ''}`} onClick={() => modal.open(<MilestoneModal engagementId={e.id} milestone={x} />)}>
            <i>{MS[x.status].icon}</i>{x.title}{x.date && <small>{fmtDate(x.date, { day: '2-digit', month: 'short' })}</small>}
          </button>
        ))}
        {!milestones.length && <span className="small muted">None yet</span>}
        {canEdit && m.bucket(e) === 'active' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => modal.open(<MilestoneModal engagementId={e.id} />)}>+ Milestone</button>}
      </div>

      <div className="mtg-notes-grid" id={'mtg-notes-' + e.id}>
        {canWrite ? <NoteBox key={e.id + session} e={e} session={session} suggestedRag={last?.rag} />
          : <div className="mtg-note-col small muted">{canEdit ? 'This engagement isn’t active, so no new notes.' : 'View-only access: editors write the notes.'}</div>}
        <div id={'mtg-hist-' + e.id} style={{ minWidth: 0 }}><History e={e} notes={notes} expanded={full} session={session} editId={editId} onEdited={onEdited} /></div>
      </div>
    </div>
  );
}

/** Write a note for this session. Saving adds it to the notes list below and clears the box. */
function NoteBox({ e, session, suggestedRag }: { e: Engagement; session: string; suggestedRag?: MeetingRag }) {
  const { act } = useWorkspace();
  const [text, setText] = useState('');
  const [rag, setRag] = useState<MeetingRag>(suggestedRag ?? 'on-track');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (suggestedRag) setRag(suggestedRag); }, [suggestedRag]);
  const save = async () => {
    setBusy(true);
    const ok = await act(() => api.post(`/engagements/${e.id}/meeting-notes`, { date: session, notes: text, rag }), 'Note saved — it’s in the notes list');
    setBusy(false);
    if (ok) setText('');
  };
  return (
    <div className="mtg-note-col">
      <div className="mtg-label">✍️ Add a note · session of {fmtDate(session)}</div>
      <textarea className="mtg-textarea" rows={4} value={text} onChange={(x) => setText(x.target.value)}
        placeholder="Where are we now · challenges · next steps · who does what · milestones" />
      <div className="mtg-note-actions">
        <RagPicker value={rag} onChange={setRag} />
        <button className="btn btn-primary btn-sm" disabled={busy || !text.trim()} onClick={save}>{busy ? 'Saving…' : '💾 Save note'}</button>
      </div>
    </div>
  );
}


/** Every note for this engagement, newest first, each with edit / delete / comments. */
function History({ e, notes, expanded, session, editId, onEdited }: { e: Engagement; notes: MeetingNote[]; expanded?: boolean; session: string; editId?: string | null; onEdited?: () => void }) {
  const { model: m } = useWorkspace();
  const toast = useToast();
  const [all, setAll] = useState(!!expanded || (!!editId && notes.findIndex((n) => n.id === editId) >= 3));
  const SHOW = 3;
  const shown = all ? notes : notes.slice(0, SHOW);
  const exportCsv = () => {
    const rows = [...notes].reverse().map((n) => ({
      date: n.date, status: RAG[n.rag].label, notes: noteText(n).map((p) => (p.label ? `${p.label}: ` : '') + p.text).join('\n'),
      actions: n.actions.map((a) => `${a.done ? '[x]' : '[ ]'} ${a.task}${a.ownerId ? ' — ' + m.name(a.ownerId) : ''}`).join(' | '),
      comments: n.comments.map((c) => `${c.by}: ${c.text}`).join(' | '), written_by: n.createdBy,
    }));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\uFEFF' + toCsv(rows, ['date', 'status', 'notes', 'actions', 'comments', 'written_by'])], { type: 'text/csv;charset=utf-8' }));
    a.download = `${e.name.replace(/[\\/:*?"<>|]+/g, ' ').trim()} - meeting notes.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    toast('Notes downloaded');
  };
  return (
    <div className="mtg-note-col mtg-history">
      <div className="mtg-label">🗂 Notes {notes.length > 0 && <span className="muted">· {notes.length}</span>}
        {notes.length > 0 && <button className="mtg-link-btn" onClick={exportCsv}>⬇ Download</button>}
      </div>
      {notes.length ? (
        <>
          <div className="mtg-timeline">{shown.map((n) => <NoteItem key={n.id} note={n} e={e} isSession={n.date === session} autoEdit={n.id === editId} onDone={n.id === editId ? onEdited : undefined} />)}</div>
          {notes.length > SHOW && <button className="mtg-link-btn" onClick={() => setAll(!all)}>{all ? '▴ Show fewer' : `▾ Show all ${notes.length} notes`}</button>}
        </>
      ) : <div className="small muted">No notes yet — notes you save appear here.</div>}
    </div>
  );
}



function MilestoneModal({ engagementId, milestone }: { engagementId: string; milestone?: Milestone }) {
  const { act } = useWorkspace();
  const modal = useModal();
  const [f, setF] = useState({ title: milestone?.title ?? '', date: milestone?.date ?? '', status: milestone?.status ?? ('planned' as MilestoneStatus) });
  const save = async () => {
    const ok = await act(() => (milestone ? api.patch(`/milestones/${milestone.id}`, f) : api.post(`/engagements/${engagementId}/milestones`, f)), milestone ? 'Milestone updated' : 'Milestone added');
    if (ok) modal.close();
  };
  return (
    <ModalFrame title={milestone ? 'Edit milestone' : 'Add a key milestone'} footer={<>
      {milestone && <button className="btn btn-danger-outline btn-sm" onClick={() => modal.open(<Confirm title="Delete milestone?" danger confirmLabel="🗑 Delete" message={<>Delete <b>{milestone.title}</b>? You can undo it from the Audit Trail.</>}
        onConfirm={() => act(() => api.del(`/milestones/${milestone.id}`), 'Milestone deleted')} />)}>🗑 Delete</button>}
      <button className="btn btn-primary btn-sm" disabled={!f.title.trim()} onClick={save}>{milestone ? 'Save' : 'Add milestone'}</button>
    </>}>
      <div className="form-grid">
        <div className="form-field full"><label>Milestone</label><input autoFocus placeholder="e.g. Inception report submitted" value={f.title} onChange={(x) => setF({ ...f, title: x.target.value })} /></div>
        <div className="form-field"><label>Target date</label><input type="date" value={f.date} onChange={(x) => setF({ ...f, date: x.target.value })} /></div>
        <div className="form-field"><label>Status</label><select value={f.status} onChange={(x) => setF({ ...f, status: x.target.value as MilestoneStatus })}>{(Object.keys(MS) as MilestoneStatus[]).map((s) => <option key={s} value={s}>{MS[s].label}</option>)}</select></div>
      </div>
    </ModalFrame>
  );
}

