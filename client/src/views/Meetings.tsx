/* Engagement Updates Meeting — a visual meeting board for the active portfolio, and a "meeting room"
   per engagement: who's who, key milestones, the last session's notes next to this session's,
   and the full archive of sessions and comments. */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { progressFor, stageLabel, toCsv } from '../../../shared/schedule';
import type { Engagement, MeetingAction, MeetingNote, MeetingRag, Milestone, MilestoneStatus } from '../../../shared/types';
import { Avatar, Card, Confirm, Empty, ModalFrame, PageHead, fmtDate, useModal, useToast } from '../components/ui';
import { api } from '../lib/api';
import { useWorkspace } from '../lib/workspace';
import type { Model } from '../../../shared/engine';

// ---------- helpers ----------
export const RAG: Record<MeetingRag, { label: string; color: string; icon: string }> = {
  'on-track': { label: 'On track', color: 'var(--ok)', icon: '🟢' },
  'at-risk': { label: 'At risk', color: '#F0A54A', icon: '🟠' },
  'off-track': { label: 'Off track', color: 'var(--danger)', icon: '🔴' },
};
const MS: Record<MilestoneStatus, { label: string; color: string }> = {
  planned: { label: 'Planned', color: 'var(--text-faint)' },
  'in-progress': { label: 'In progress', color: 'var(--accent)' },
  done: { label: 'Done', color: 'var(--ok)' },
  delayed: { label: 'Delayed', color: 'var(--danger)' },
};
const today = () => new Date().toISOString().slice(0, 10);
const daysSince = (d: string) => Math.floor((Date.parse(today()) - Date.parse(d)) / 86_400_000);
const ago = (d: string) => { const n = daysSince(d); return n <= 0 ? 'today' : n === 1 ? 'yesterday' : n < 0 ? 'upcoming' : `${n} days ago`; };
const STALE_DAYS = 14;

function useMeetingData() {
  const { data } = useWorkspace();
  return useMemo(() => {
    const notes = new Map<string, MeetingNote[]>();
    for (const n of data.meetingNotes ?? []) (notes.get(n.engagementId) ?? notes.set(n.engagementId, []).get(n.engagementId)!).push(n);
    for (const list of notes.values()) list.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
    const milestones = new Map<string, Milestone[]>();
    for (const m of data.milestones ?? []) (milestones.get(m.engagementId) ?? milestones.set(m.engagementId, []).get(m.engagementId)!).push(m);
    for (const list of milestones.values()) list.sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999') || a.createdAt.localeCompare(b.createdAt));
    return { notesFor: (id: string) => notes.get(id) ?? [], milestonesFor: (id: string) => milestones.get(id) ?? [] };
  }, [data.meetingNotes, data.milestones]);
}

/** Progress shown on the ring: the leader's estimate from the last session, else the lifecycle stage. */
const progressOf = (e: Engagement, last?: MeetingNote) => (last?.progress ?? progressFor(e.scope, e.stage));
const staffOf = (e: Engagement) => [...new Set([e.leadId, ...(e.supervisorId ? [e.supervisorId] : []), ...e.teamIds])];
const openActions = (notes: MeetingNote[]) => (notes[0]?.actions ?? []).filter((a) => !a.done);
const overdue = (a: MeetingAction) => !a.done && !!a.due && a.due < today();

// ---------- small visuals ----------
function Ring({ pct, color, size = 64, stroke = 7, children }: { pct: number; color: string; size?: number; stroke?: number; children?: ReactNode }) {
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

function AvatarStack({ m, ids, max = 5 }: { m: Model; ids: string[]; max?: number }) {
  return (
    <div className="mtg-stack">
      {ids.slice(0, max).map((id) => <span key={id} title={m.name(id)}><Avatar text={m.talentById.get(id)?.initials ?? '?'} size={24} /></span>)}
      {ids.length > max && <span className="mtg-stack-more">+{ids.length - max}</span>}
    </div>
  );
}

/** Milestones on a line, placed by date, with a "today" marker. */
function MilestoneTrack({ list, compact, onPick }: { list: Milestone[]; compact?: boolean; onPick?: (m: Milestone) => void }) {
  const dated = list.filter((x) => x.date);
  if (!list.length) return compact ? <div className="mtg-track-empty">No milestones yet</div> : null;
  const t = today();
  const times = [...dated.map((x) => Date.parse(x.date!)), Date.parse(t)];
  const min = Math.min(...times);
  const max = Math.max(...times);
  const pos = (d: string) => (max === min ? 50 : 4 + ((Date.parse(d) - min) / (max - min)) * 92);
  return (
    <div className={'mtg-track' + (compact ? ' compact' : '')}>
      <div className="mtg-track-line" />
      {dated.length > 0 && <div className="mtg-today" style={{ left: pos(t) + '%' }} title="Today"><span>Today</span></div>}
      {dated.map((x, i) => (
        <button key={x.id} type="button" className="mtg-dot" style={{ left: pos(x.date!) + '%', background: MS[x.status].color }}
          title={`${x.title} · ${fmtDate(x.date!)} · ${MS[x.status].label}`} onClick={onPick ? () => onPick(x) : undefined}>
          {!compact && <span className={'mtg-dot-label ' + (i % 2 ? 'down' : 'up') + (pos(x.date!) < 18 ? ' edge-l' : pos(x.date!) > 82 ? ' edge-r' : '')}><b>{x.title}</b><br />{fmtDate(x.date!, { day: '2-digit', month: 'short' })}</span>}
        </button>
      ))}
      {compact && list.length > dated.length && <span className="mtg-track-undated">+{list.length - dated.length} undated</span>}
    </div>
  );
}

// ---------- page ----------
export default function Meetings() {
  const [params, setParams] = useSearchParams();
  const id = params.get('e');
  const open = (eid: string | null) => { setParams(eid ? { e: eid } : {}); window.scrollTo({ top: 0 }); };
  return id ? <MeetingRoom id={id} onOpen={open} /> : <Board onOpen={open} />;
}

function Board({ onOpen }: { onOpen: (id: string) => void }) {
  const { model: m } = useWorkspace();
  const { notesFor, milestonesFor } = useMeetingData();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'attention' | 'name' | 'lead'>('attention');
  const [scope, setScope] = useState<'active' | 'archive'>('active');

  const all = m.engagements.filter((e) => (scope === 'active' ? m.bucket(e) === 'active' : (m.bucket(e) !== 'active' && notesFor(e.id).length > 0)));
  const rows = all.filter((e) => !q || `${e.name} ${e.client} ${m.name(e.leadId)}`.toLowerCase().includes(q.toLowerCase()));
  const attention = (e: Engagement) => {
    const last = notesFor(e.id)[0];
    if (!last) return 0;
    return (last.rag === 'off-track' ? 1 : last.rag === 'at-risk' ? 2 : 4) + (daysSince(last.date) > STALE_DAYS ? 0 : 1);
  };
  const sorted = [...rows].sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name)
    : sort === 'lead' ? m.name(a.leadId).localeCompare(m.name(b.leadId)) || a.name.localeCompare(b.name)
      : attention(a) - attention(b) || a.name.localeCompare(b.name)));

  // Portfolio pulse (active engagements only).
  const active = m.engagements.filter((e) => m.bucket(e) === 'active');
  const lasts = active.map((e) => notesFor(e.id)[0]);
  const fresh = lasts.filter((n) => n && daysSince(n.date) <= STALE_DAYS).length;
  const ragCount = (r: MeetingRag) => lasts.filter((n) => n?.rag === r).length;
  const noUpdate = lasts.filter((n) => !n).length;
  const actions = active.flatMap((e) => openActions(notesFor(e.id)));
  const late = actions.filter(overdue).length;
  const freshPct = active.length ? Math.round((fresh / active.length) * 100) : 0;

  return (
    <>
      <PageHead title="Engagement Updates Meeting" desc="Walk through each active engagement: where it stands, its challenges, next steps and who does what. Pick an engagement to open its meeting room." />
      <div className="mtg-pulse">
        <div className="mtg-pulse-tile">
          <Ring pct={freshPct} color="var(--accent)" size={72}><b>{fresh}</b><small>/{active.length}</small></Ring>
          <div><div className="mtg-pulse-title">Updated recently</div><div className="mtg-pulse-sub">engagements with notes in the last {STALE_DAYS} days</div></div>
        </div>
        <div className="mtg-pulse-tile">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="mtg-pulse-title">Status from the last sessions</div>
            <div className="mtg-ragbar" role="img" aria-label="Status split">
              {(['on-track', 'at-risk', 'off-track'] as MeetingRag[]).map((r) => ragCount(r) > 0 && <div key={r} style={{ flex: ragCount(r), background: RAG[r].color }} />)}
              {noUpdate > 0 && <div style={{ flex: noUpdate, background: 'var(--border)' }} />}
            </div>
            <div className="mtg-legend">
              {(['on-track', 'at-risk', 'off-track'] as MeetingRag[]).map((r) => <span key={r}><i style={{ background: RAG[r].color }} />{RAG[r].label} <b>{ragCount(r)}</b></span>)}
              <span><i style={{ background: 'var(--border)' }} />No update <b>{noUpdate}</b></span>
            </div>
          </div>
        </div>
        <div className="mtg-pulse-tile">
          <div className="mtg-big" style={{ color: 'var(--lavender)' }}>{actions.length}</div>
          <div><div className="mtg-pulse-title">Open actions</div><div className="mtg-pulse-sub">from the latest sessions</div></div>
        </div>
        <div className="mtg-pulse-tile">
          <div className="mtg-big" style={{ color: late ? 'var(--danger)' : 'var(--ok)' }}>{late}</div>
          <div><div className="mtg-pulse-title">Overdue actions</div><div className="mtg-pulse-sub">{late ? 'past their due date' : 'nothing overdue'}</div></div>
        </div>
      </div>

      <div className="filters-bar">
        <input type="text" placeholder="Search engagement, client or leader…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
          <option value="attention">Needs attention first</option><option value="name">By name</option><option value="lead">By leader</option>
        </select>
        <select value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
          <option value="active">Active engagements</option><option value="archive">Archive: closed engagements with notes</option>
        </select>
      </div>

      {sorted.length ? (
        <div className="mtg-grid">
          {sorted.map((e) => {
            const notes = notesFor(e.id);
            const last = notes[0];
            const rag = last ? RAG[last.rag] : null;
            const open = openActions(notes);
            const done = (last?.actions.length ?? 0) - open.length;
            return (
              <button key={e.id} type="button" className="mtg-tile" onClick={() => onOpen(e.id)} style={{ ['--rag' as string]: rag?.color ?? 'var(--border)' }}>
                <div className="mtg-tile-band" />
                <div className="mtg-tile-top">
                  <Ring pct={progressOf(e, last)} color={rag?.color ?? 'var(--accent)'} size={58} stroke={6} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="mtg-tile-name">{e.name}</div>
                    <div className="mtg-tile-client">{e.client} · {stageLabel(e.stage)}</div>
                    <div className="mtg-tile-rag" style={{ color: rag?.color ?? 'var(--text-faint)' }}>{rag ? `${rag.icon} ${rag.label}` : '⚪ No update yet'}</div>
                  </div>
                </div>
                <div className="mtg-tile-team">
                  <span className="mtg-lead" title="Engagement leader">👑 {m.name(e.leadId)}</span>
                  <AvatarStack m={m} ids={staffOf(e).filter((x) => x !== e.leadId)} />
                </div>
                <MilestoneTrack list={milestonesFor(e.id)} compact />
                <div className="mtg-tile-foot">
                  <span className={last && daysSince(last.date) > STALE_DAYS ? 'stale' : ''}>🗓 {last ? `Last update ${ago(last.date)}` : 'No sessions yet'}</span>
                  {last && last.actions.length > 0 && <span className={open.some(overdue) ? 'late' : ''}>✅ {done}/{last.actions.length} actions</span>}
                </div>
              </button>
            );
          })}
        </div>
      ) : <Card><Empty>{scope === 'active' ? 'No active engagements match.' : 'No closed engagements have meeting notes yet.'}</Empty></Card>}
    </>
  );
}

// ---------- meeting room ----------
function MeetingRoom({ id, onOpen }: { id: string; onOpen: (id: string | null) => void }) {
  const { model: m, canEdit, act } = useWorkspace();
  const modal = useModal();
  const { notesFor, milestonesFor } = useMeetingData();
  const e = m.engagement(id);
  if (!e || e.status === 'deleted') return <Card><Empty>That engagement can’t be found. <button className="btn btn-sm" onClick={() => onOpen(null)}>← Back to the board</button></Empty></Card>;
  const notes = notesFor(e.id);
  const last = notes[0];
  const milestones = milestonesFor(e.id);
  const staff = staffOf(e);
  const isActive = m.bucket(e) === 'active';
  const activeIds = m.engagements.filter((x) => m.bucket(x) === 'active').map((x) => x.id);
  const idx = activeIds.indexOf(e.id);
  const rag = last ? RAG[last.rag] : null;
  const openByPerson = (pid: string) => openActions(notes).filter((a) => a.ownerId === pid).length;
  const role = (pid: string) => (pid === e.leadId ? 'Engagement leader' : pid === e.supervisorId ? 'Supervisor' : m.talentById.get(pid)?.department === 'Operations' ? 'Operations' : 'Team member');

  return (
    <>
      <div className="mtg-nav">
        <button className="btn btn-sm" onClick={() => onOpen(null)}>← All engagements</button>
        {idx >= 0 && activeIds.length > 1 && (
          <div className="row" style={{ gap: 6 }}>
            <button className="btn btn-sm" disabled={idx === 0} onClick={() => onOpen(activeIds[idx - 1])}>‹ Previous</button>
            <span className="small muted">{idx + 1} of {activeIds.length}</span>
            <button className="btn btn-sm btn-primary" disabled={idx === activeIds.length - 1} onClick={() => onOpen(activeIds[idx + 1])}>Next engagement ›</button>
          </div>
        )}
      </div>

      <div className="card mtg-hero" style={{ ['--rag' as string]: rag?.color ?? 'var(--accent)' }}>
        <Ring pct={progressOf(e, last)} color={rag?.color ?? 'var(--accent)'} size={96} stroke={9} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="mtg-hero-name">{e.name}</div>
          <div className="mtg-hero-meta">{e.client} · {e.sector} · {e.scope}</div>
          <div className="mtg-chips">
            <span className="mtg-chip">📍 {stageLabel(e.stage)}</span>
            <span className="mtg-chip">🗓 Started {fmtDate(e.start)}</span>
            {e.end && <span className="mtg-chip">🏁 Ends {fmtDate(e.end)}</span>}
            <span className="mtg-chip" style={{ color: rag?.color }}>{rag ? `${rag.icon} ${rag.label}` : '⚪ No update yet'}</span>
            <span className="mtg-chip">🗂 {notes.length} session{notes.length === 1 ? '' : 's'}</span>
            {!isActive && <span className="mtg-chip">🔒 {m.bucket(e)}</span>}
          </div>
          <div className="small muted" style={{ marginTop: 6 }}>Ring = {last?.progress != null ? 'the leader’s progress estimate from the last session' : 'progress implied by the lifecycle stage'}.</div>
        </div>
      </div>

      <div className="mtg-two">
        <Card title="👥 Who’s who">
          <div className="mtg-people">
            {staff.map((pid) => {
              const n = openByPerson(pid);
              return (
                <div key={pid} className={'mtg-person' + (pid === e.leadId ? ' lead' : '')}>
                  <Avatar text={m.talentById.get(pid)?.initials ?? '?'} size={34} />
                  <div style={{ minWidth: 0 }}>
                    <div className="mtg-person-name">{m.name(pid)}</div>
                    <div className="mtg-person-role">{role(pid)} · {m.talentById.get(pid)?.title}</div>
                  </div>
                  {n > 0 && <span className="mtg-badge" title="Open actions">{n}</span>}
                </div>
              );
            })}
          </div>
        </Card>
        <Card title="🏁 Key milestones" sub={canEdit && <button className="btn btn-sm" onClick={() => modal.open(<MilestoneModal engagementId={e.id} />)}>+ Add milestone</button>}>
          {milestones.length ? (
            <>
              <MilestoneTrack list={milestones} onPick={canEdit ? (x) => modal.open(<MilestoneModal engagementId={e.id} milestone={x} />) : undefined} />
              <div className="mtg-ms-list">
                {milestones.map((x) => (
                  <div key={x.id} className="mtg-ms-row" onClick={canEdit ? () => modal.open(<MilestoneModal engagementId={e.id} milestone={x} />) : undefined} style={canEdit ? { cursor: 'pointer' } : undefined}>
                    <i style={{ background: MS[x.status].color }} />
                    <span className="mtg-ms-title">{x.title}</span>
                    <span className="small muted">{x.date ? fmtDate(x.date) : 'No date'}</span>
                    <span className="small" style={{ color: MS[x.status].color }}>{MS[x.status].label}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <Empty>No milestones yet.{canEdit && ' Add the key milestones so the team can see where the engagement stands against them.'}
              {canEdit && e.customCps?.length ? <div style={{ marginTop: 8 }}><button className="btn btn-sm" onClick={() => act(async () => {
                for (const s of e.customCps!) await api.post(`/engagements/${e.id}/milestones`, { title: stageLabel(s.id), date: s.end, status: s.end < today() ? 'done' : s.start <= today() ? 'in-progress' : 'planned' });
              }, 'CPS stages added as milestones')}>📤 Use the uploaded CPS stages</button></div> : null}
            </Empty>
          )}
        </Card>
      </div>

      <div className="mtg-two">
        <Card title={last ? `🗂 Last session · ${fmtDate(last.date)}` : '🗂 Last session'} sub={last && <span>by {last.createdBy}</span>}>
          {last ? <SessionView note={last} m={m} /> : <Empty>No sessions yet. {canEdit ? 'Write the first one on the right.' : ''}</Empty>}
        </Card>
        {canEdit && isActive ? (
          <Card title="✍️ This session" className="mtg-write">
            <SessionForm key={e.id + (last?.id ?? '')} e={e} m={m} carry={last ? openActions(notes) : []} milestones={milestones}
              onSave={(body) => act(() => api.post(`/engagements/${e.id}/meeting-notes`, body), 'Session notes saved')} />
          </Card>
        ) : (
          <Card title="✍️ This session"><Empty>{!canEdit ? 'View-only access: an editor writes the session notes.' : 'This engagement is not active, so new sessions are closed. Its archive stays below.'}</Empty></Card>
        )}
      </div>

      <Archive e={e} notes={notes} />
    </>
  );
}

/** One session's notes, laid out as the four questions the leader answers. */
function SessionView({ note, m, compact }: { note: MeetingNote; m: Model; compact?: boolean }) {
  const { canEdit, act } = useWorkspace();
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const toggle = async (a: MeetingAction, done: boolean) => {
    setPending((p) => ({ ...p, [a.id]: done }));
    await act(() => api.put(`/meeting-notes/${note.id}/actions/${a.id}`, { done }));
    setPending((p) => { const { [a.id]: _, ...rest } = p; return rest; }); // eslint-disable-line @typescript-eslint/no-unused-vars
  };
  const rag = RAG[note.rag];
  const block = (icon: string, q: string, a: string, tone?: string) => (
    <div className="mtg-q" style={tone ? { borderColor: tone } : undefined}>
      <div className="mtg-q-head">{icon} {q}</div>
      <div className="mtg-q-body">{a || <span className="muted">—</span>}</div>
    </div>
  );
  return (
    <div>
      {!compact && (
        <div className="mtg-chips" style={{ marginBottom: 10 }}>
          <span className="mtg-chip" style={{ color: rag.color }}>{rag.icon} {rag.label}</span>
          {note.progress != null && <span className="mtg-chip">📈 {note.progress}% done</span>}
        </div>
      )}
      <div className="mtg-qs">
        {block('📍', 'Where are we now?', note.whereWeAre)}
        {block('⚠️', 'Challenges', note.challenges, note.challenges ? 'var(--warn)' : undefined)}
        {block('➡️', 'Next steps', note.nextSteps)}
      </div>
      <div className="mtg-q-head" style={{ margin: '12px 0 6px' }}>👥 Who does what</div>
      {note.actions.length ? (
        <div className="mtg-actions">
          {note.actions.map((x) => ({ ...x, done: pending[x.id] ?? x.done })).map((a) => (
            <label key={a.id} className={'mtg-action' + (a.done ? ' done' : '') + (overdue(a) ? ' late' : '')}>
              <input type="checkbox" checked={a.done} disabled={!canEdit} onChange={(x) => toggle(a, x.target.checked)} />
              <span className="mtg-action-task">{a.task}</span>
              <span className="mtg-action-owner">{a.ownerId ? <><Avatar text={m.talentById.get(a.ownerId)?.initials ?? '?'} size={20} /> {m.name(a.ownerId)}</> : <span className="muted">Unassigned</span>}</span>
              <span className="mtg-action-due">{a.due ? (overdue(a) ? `⏰ ${fmtDate(a.due, { day: '2-digit', month: 'short' })}` : fmtDate(a.due, { day: '2-digit', month: 'short' })) : ''}</span>
            </label>
          ))}
        </div>
      ) : <div className="small muted">No actions recorded.</div>}
    </div>
  );
}

/** `from` = the open action from the last session this one was carried over from. */
type DraftAction = MeetingAction & { from?: string };
type SessionBody = { date: string; rag: MeetingRag; progress: number | null; whereWeAre: string; challenges: string; nextSteps: string; actions: DraftAction[] };

/** The notes form: used for a new session (with open actions carried over) and to edit an archived one. */
function SessionForm({ e, m, carry, milestones, initial, onSave }: {
  e: Engagement; m: Model; carry: MeetingAction[]; milestones: Milestone[]; initial?: MeetingNote; onSave: (b: SessionBody) => Promise<boolean>;
}) {
  const blank = (): SessionBody => ({ date: today(), rag: 'on-track', progress: null, whereWeAre: '', challenges: '', nextSteps: '', actions: carry.map((a) => ({ ...a, id: '', from: a.id })) });
  const [f, setF] = useState<SessionBody>(() => (initial ? { date: initial.date, rag: initial.rag, progress: initial.progress, whereWeAre: initial.whereWeAre, challenges: initial.challenges, nextSteps: initial.nextSteps, actions: initial.actions } : blank()));
  const [busy, setBusy] = useState(false);
  // An action ticked done (or deleted) in the last session while this form is open: stop carrying it over.
  const carryKey = carry.map((a) => a.id).join(',');
  useEffect(() => {
    const open = new Set(carryKey.split(','));
    setF((x) => ({ ...x, actions: x.actions.filter((a) => !a.from || open.has(a.from)) }));
  }, [carryKey]);
  const staff = staffOf(e);
  const setA = (i: number, patch: Partial<DraftAction>) => setF({ ...f, actions: f.actions.map((a, j) => (j === i ? { ...a, ...patch } : a)) });
  const nextMs = milestones.filter((x) => x.status !== 'done').slice(0, 3);
  const empty = !f.whereWeAre.trim() && !f.challenges.trim() && !f.nextSteps.trim() && !f.actions.some((a) => a.task.trim());
  const save = async () => {
    setBusy(true);
    const ok = await onSave({ ...f, actions: f.actions.filter((a) => a.task.trim()).map(({ from: _from, ...a }) => a) }); // eslint-disable-line @typescript-eslint/no-unused-vars
    setBusy(false);
    if (ok && !initial) setF(blank());
  };
  return (
    <div className="mtg-form">
      <div className="mtg-form-row">
        <div className="form-field"><label>Meeting date</label><input type="date" value={f.date} onChange={(x) => setF({ ...f, date: x.target.value })} /></div>
        <div className="form-field" style={{ flex: 2 }}>
          <label>Overall status</label>
          <div className="mtg-seg">
            {(Object.keys(RAG) as MeetingRag[]).map((r) => (
              <button key={r} type="button" className={f.rag === r ? 'on' : ''} style={f.rag === r ? { background: RAG[r].color, borderColor: RAG[r].color } : undefined} onClick={() => setF({ ...f, rag: r })}>{RAG[r].label}</button>
            ))}
          </div>
        </div>
      </div>
      <div className="form-field">
        <label>Progress estimate {f.progress == null ? <span className="muted">(optional — defaults to the lifecycle stage, {progressFor(e.scope, e.stage)}%)</span> : <b>{f.progress}%</b>}</label>
        <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
          <input type="range" min={0} max={100} step={5} value={f.progress ?? progressFor(e.scope, e.stage)} onChange={(x) => setF({ ...f, progress: Number(x.target.value) })} style={{ flex: 1, minWidth: 0 }} />
          {f.progress != null && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setF({ ...f, progress: null })}>Clear</button>}
        </div>
      </div>
      {nextMs.length > 0 && (
        <div className="mtg-ref">
          <span>🏁 Milestones to reference:</span>
          {nextMs.map((x) => <span key={x.id} className="mtg-chip" style={{ color: MS[x.status].color }}>{x.title}{x.date ? ` · ${fmtDate(x.date, { day: '2-digit', month: 'short' })}` : ''}</span>)}
        </div>
      )}
      <div className="form-field"><label>📍 Where are we now?</label><textarea rows={3} placeholder="What has been delivered since the last session; which milestone are we at…" value={f.whereWeAre} onChange={(x) => setF({ ...f, whereWeAre: x.target.value })} /></div>
      <div className="form-field"><label>⚠️ Are there any challenges?</label><textarea rows={3} placeholder="Risks, blockers, client issues, resourcing…" value={f.challenges} onChange={(x) => setF({ ...f, challenges: x.target.value })} /></div>
      <div className="form-field"><label>➡️ What are the next steps?</label><textarea rows={3} placeholder="What happens before the next session…" value={f.nextSteps} onChange={(x) => setF({ ...f, nextSteps: x.target.value })} /></div>
      <div className="form-field">
        <label>👥 Who does what {carry.length > 0 && !initial && <span className="muted">— open actions from the last session are carried over</span>}</label>
        <div className="mtg-action-edit">
          {f.actions.map((a, i) => (
            <div key={i} className="mtg-action-edit-row">
              <input type="checkbox" checked={a.done} title="Done" onChange={(x) => setA(i, { done: x.target.checked })} />
              <input className="task" placeholder="Task" value={a.task} onChange={(x) => setA(i, { task: x.target.value })} />
              <select value={a.ownerId ?? ''} onChange={(x) => setA(i, { ownerId: x.target.value || null })}>
                <option value="">Owner…</option>
                {staff.map((pid) => <option key={pid} value={pid}>{m.name(pid)}</option>)}
                {a.ownerId && !staff.includes(a.ownerId) && <option value={a.ownerId}>{m.name(a.ownerId)}</option>}
              </select>
              <input type="date" value={a.due ?? ''} onChange={(x) => setA(i, { due: x.target.value || null })} />
              <button type="button" className="btn btn-ghost btn-sm" aria-label="Remove action" onClick={() => setF({ ...f, actions: f.actions.filter((_, j) => j !== i) })}>✕</button>
            </div>
          ))}
          <button type="button" className="btn btn-sm" onClick={() => setF({ ...f, actions: [...f.actions, { id: '', task: '', ownerId: null, due: null, done: false }] })}>+ Add action</button>
        </div>
      </div>
      <button className="btn btn-primary" disabled={busy || empty || !f.date} onClick={save}>{busy ? 'Saving…' : initial ? 'Save changes' : '💾 Save session notes'}</button>
    </div>
  );
}

function EditSessionModal({ note }: { note: MeetingNote }) {
  const { model: m, act } = useWorkspace();
  const modal = useModal();
  const e = m.engagement(note.engagementId)!;
  return (
    <ModalFrame wide title={`Edit session · ${fmtDate(note.date)}`}>
      <SessionForm e={e} m={m} carry={[]} milestones={[]} initial={note}
        onSave={async (b) => { const ok = await act(() => api.patch(`/meeting-notes/${note.id}`, b), 'Session updated'); if (ok) modal.close(); return ok; }} />
    </ModalFrame>
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

/** Every session for this engagement, newest first, with comments. */
function Archive({ e, notes }: { e: Engagement; notes: MeetingNote[] }) {
  const { model: m, canEdit, act } = useWorkspace();
  const modal = useModal();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => setOpenId(null), [e.id]);
  const shown = notes.filter((n) => !q || [n.whereWeAre, n.challenges, n.nextSteps, n.createdBy, ...n.actions.map((a) => a.task), ...n.comments.map((c) => c.text)].join(' ').toLowerCase().includes(q.toLowerCase()));
  const exportCsv = () => {
    const rows = notes.map((n) => ({
      date: n.date, status: RAG[n.rag].label, progress: n.progress ?? '', where_we_are: n.whereWeAre, challenges: n.challenges, next_steps: n.nextSteps,
      actions: n.actions.map((a) => `${a.done ? '[x]' : '[ ]'} ${a.task}${a.ownerId ? ' — ' + m.name(a.ownerId) : ''}${a.due ? ' (due ' + a.due + ')' : ''}`).join(' | '),
      comments: n.comments.map((c) => `${c.by}: ${c.text}`).join(' | '), written_by: n.createdBy,
    }));
    const blob = new Blob(['﻿' + toCsv(rows, ['date', 'status', 'progress', 'where_we_are', 'challenges', 'next_steps', 'actions', 'comments', 'written_by'])], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${e.name.replace(/[\\/:*?"<>|]+/g, ' ').trim()} - meeting notes.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    toast('Meeting notes downloaded');
  };
  return (
    <Card title={`🗄 Session archive · ${notes.length}`} sub={notes.length > 0 && <button className="btn btn-sm" onClick={exportCsv}>⬇ Download notes (Excel)</button>}>
      {notes.length > 1 && <div className="filters-bar" style={{ marginBottom: 10 }}><input type="text" placeholder="Search notes, actions and comments…" value={q} onChange={(x) => setQ(x.target.value)} /></div>}
      {shown.length ? (
        <div className="mtg-archive">
          {shown.map((n, i) => {
            const isOpen = openId === n.id || (openId === null && i === 0 && !!q);
            const doneCount = n.actions.filter((a) => a.done).length;
            return (
              <div key={n.id} className={'mtg-arch' + (isOpen ? ' open' : '')} style={{ ['--rag' as string]: RAG[n.rag].color }}>
                <button type="button" className="mtg-arch-head" onClick={() => setOpenId(isOpen ? '' : n.id)}>
                  <span className="mtg-arch-dot" />
                  <b>{fmtDate(n.date)}</b>
                  <span className="small" style={{ color: RAG[n.rag].color }}>{RAG[n.rag].label}</span>
                  <span className="small muted mtg-arch-sum">{n.whereWeAre.split('\n')[0].slice(0, 90) || n.nextSteps.split('\n')[0].slice(0, 90)}</span>
                  <span className="small muted">✅ {doneCount}/{n.actions.length} · 💬 {n.comments.length}</span>
                  <span className="muted">{isOpen ? '▾' : '▸'}</span>
                </button>
                {isOpen && (
                  <div className="mtg-arch-body">
                    <div className="small muted" style={{ marginBottom: 8 }}>Written by {n.createdBy} · {fmtDate(n.createdAt)}{n.updatedAt !== n.createdAt ? ` · edited ${fmtDate(n.updatedAt)}` : ''}</div>
                    <SessionView note={n} m={m} />
                    <Comments note={n} />
                    {canEdit && (
                      <div className="row" style={{ gap: 6, marginTop: 10 }}>
                        <button className="btn btn-sm" onClick={() => modal.open(<EditSessionModal note={n} />)}>✏️ Edit</button>
                        <button className="btn btn-sm btn-danger-outline" onClick={() => modal.open(<Confirm title="Delete this session?" danger confirmLabel="🗑 Delete" message={<>Delete the notes from <b>{fmtDate(n.date)}</b>, with their actions and comments? You can undo it from the Audit Trail.</>}
                          onConfirm={() => act(() => api.del(`/meeting-notes/${n.id}`), 'Session deleted')} />)}>🗑 Delete</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : <Empty>{notes.length ? 'No sessions match your search.' : 'Sessions appear here once notes are saved — every session and comment is kept.'}</Empty>}
    </Card>
  );
}

function Comments({ note }: { note: MeetingNote }) {
  const { canEdit, act, user } = useWorkspace();
  const [text, setText] = useState('');
  return (
    <div className="mtg-comments">
      <div className="mtg-q-head">💬 Comments</div>
      {note.comments.length ? note.comments.map((c) => (
        <div key={c.id} className="mtg-comment">
          <div className="small"><b>{c.by}</b> <span className="muted">· {fmtDate(c.at, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
            {canEdit && (c.by === user.name || user.role === 'admin') && <button className="mtg-link" onClick={() => act(() => api.del(`/meeting-notes/${note.id}/comments/${c.id}`), 'Comment deleted')}>Delete</button>}
          </div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{c.text}</div>
        </div>
      )) : <div className="small muted">No comments yet.</div>}
      {canEdit && (
        <div className="mtg-comment-new">
          <input placeholder="Add a comment…" value={text} onChange={(x) => setText(x.target.value)}
            onKeyDown={async (x) => { if (x.key === 'Enter' && text.trim()) { if (await act(() => api.post(`/meeting-notes/${note.id}/comments`, { text }))) setText(''); } }} />
          <button className="btn btn-sm" disabled={!text.trim()} onClick={async () => { if (await act(() => api.post(`/meeting-notes/${note.id}/comments`, { text }), 'Comment added')) setText(''); }}>Post</button>
        </div>
      )}
    </div>
  );
}
