/* Engagement Updates Meeting — one list of the engagements (like Engagement Status), where every
   project shows its full team, its key milestones, its own notes box for today's session, and the
   notes from earlier sessions. The meeting questions are shown once, at the top, as a reference. */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { progressFor, stageLabel, toCsv } from '../../../shared/schedule';
import type { Engagement, MeetingNote, MeetingRag, Milestone, MilestoneStatus } from '../../../shared/types';
import type { Model } from '../../../shared/engine';
import { Avatar, Card, Confirm, Empty, ModalFrame, PageHead, fmtDate, useModal, useToast } from '../components/ui';
import { api } from '../lib/api';
import { useWorkspace } from '../lib/workspace';

export const RAG: Record<MeetingRag, { label: string; color: string; icon: string }> = {
  'on-track': { label: 'On track', color: 'var(--ok)', icon: '🟢' },
  'at-risk': { label: 'At risk', color: '#F0A54A', icon: '🟠' },
  'off-track': { label: 'Off track', color: 'var(--danger)', icon: '🔴' },
};
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
const ago = (d: string) => { const n = daysSince(d); return n < 0 ? 'upcoming' : n === 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`; };
const STALE_DAYS = 14;
const staffOf = (e: Engagement) => [...new Set([e.leadId, ...(e.supervisorId ? [e.supervisorId] : []), ...e.teamIds])];

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

/** A note's text: the free-text notes, plus any structured answers it was written with. */
function noteText(n: MeetingNote): { label?: string; text: string }[] {
  const parts: { label?: string; text: string }[] = [];
  if (n.notes) parts.push({ text: n.notes });
  if (n.whereWeAre) parts.push({ label: '📍 Where are we now', text: n.whereWeAre });
  if (n.challenges) parts.push({ label: '⚠️ Challenges', text: n.challenges });
  if (n.nextSteps) parts.push({ label: '➡️ Next steps', text: n.nextSteps });
  return parts;
}

// ---------- page ----------
export default function Meetings() {
  const { model: m, canEdit } = useWorkspace();
  const { notesFor, milestonesFor } = useMeetingData();
  const [params] = useSearchParams();
  const [session, setSession] = useState(today());
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'attention' | 'name' | 'lead'>('attention');
  const [scope, setScope] = useState<'active' | 'archive'>('active');

  const active = m.engagements.filter((e) => m.bucket(e) === 'active');
  const list = scope === 'active' ? active : m.engagements.filter((e) => m.bucket(e) !== 'active' && e.status !== 'deleted' && notesFor(e.id).length > 0);
  const rows = list.filter((e) => !q || `${e.name} ${e.client} ${staffOf(e).map((id) => m.name(id)).join(' ')}`.toLowerCase().includes(q.toLowerCase()));
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
        : attention(a) - attention(b) || a.name.localeCompare(b.name))).map((e) => e.id));
  }, [sort, scope, list.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const rank = new Map(order.map((id, i) => [id, i]));
  const sorted = [...rows].sort((a, b) => (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999));

  // Open a specific engagement from a link (?e=<id>).
  const target = params.get('e');
  useEffect(() => { if (target) document.getElementById('mtg-' + target)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [target, order.length]);

  const lasts = active.map((e) => notesFor(e.id)[0]);
  const thisSession = active.filter((e) => notesFor(e.id).some((n) => n.date === session)).length;
  const ragCount = (r: MeetingRag) => lasts.filter((n) => n?.rag === r).length;
  const noUpdate = lasts.filter((n) => !n).length;

  return (
    <>
      <PageHead title="Engagement Updates Meeting" desc="Every active engagement with its full team, key milestones and notes by session. Write each project’s notes in its own box; earlier sessions stay underneath.">
        <label className="mtg-session-pick">🗓 Session date <input type="date" value={session} max="2100-12-31" onChange={(x) => x.target.value && setSession(x.target.value)} /></label>
      </PageHead>

      <div className="mtg-top">
        <div className="card mtg-questions">
          <div className="mtg-questions-title">Questions to cover for each engagement</div>
          <ol>
            {MEETING_QUESTIONS.map((x) => <li key={x.q}><span className="mtg-qi">{x.icon}</span><div><b>{x.q}</b><small>{x.hint}</small></div></li>)}
          </ol>
        </div>
        <div className="card mtg-pulse-card">
          <div className="mtg-pulse-row">
            <Ring pct={active.length ? (thisSession / active.length) * 100 : 0} color="var(--accent)" size={66} stroke={7}><b>{thisSession}</b><small>/{active.length}</small></Ring>
            <div><div className="mtg-pulse-title">Notes written this session</div><div className="mtg-pulse-sub">{fmtDate(session)}</div></div>
          </div>
          <div className="mtg-pulse-title" style={{ marginTop: 14 }}>Status from the latest notes</div>
          <div className="mtg-ragbar" role="img" aria-label="Status split">
            {(['on-track', 'at-risk', 'off-track'] as MeetingRag[]).map((r) => ragCount(r) > 0 && <div key={r} style={{ flex: ragCount(r), background: RAG[r].color }} />)}
            {noUpdate > 0 && <div style={{ flex: noUpdate, background: 'var(--border)' }} />}
          </div>
          <div className="mtg-legend">
            {(['on-track', 'at-risk', 'off-track'] as MeetingRag[]).map((r) => <span key={r}><i style={{ background: RAG[r].color }} />{RAG[r].label} <b>{ragCount(r)}</b></span>)}
            <span><i style={{ background: 'var(--border)' }} />No notes yet <b>{noUpdate}</b></span>
          </div>
        </div>
      </div>

      <div className="filters-bar">
        <input type="text" placeholder="Search engagement, client or team member…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
          <option value="attention">Needs attention first</option><option value="name">By name</option><option value="lead">By leader</option>
        </select>
        <select value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
          <option value="active">Active engagements ({active.length})</option><option value="archive">Archive: closed engagements with notes</option>
        </select>
      </div>

      {sorted.length ? (
        <div className="mtg-list">
          {sorted.map((e) => <ProjectCard key={e.id} e={e} m={m} session={session} notes={notesFor(e.id)} milestones={milestonesFor(e.id)} canWrite={canEdit && m.bucket(e) === 'active'} />)}
        </div>
      ) : <Card><Empty>{scope === 'active' ? 'No active engagements match.' : 'No closed engagements have notes yet.'}</Empty></Card>}
    </>
  );
}

// ---------- one engagement ----------
function ProjectCard({ e, m, session, notes, milestones, canWrite }: { e: Engagement; m: Model; session: string; notes: MeetingNote[]; milestones: Milestone[]; canWrite: boolean }) {
  const { canEdit } = useWorkspace();
  const modal = useModal();
  const last = notes[0];
  const rag = last ? RAG[last.rag] : null;
  const pct = last?.progress ?? progressFor(e.scope, e.stage);
  const current = notes.find((n) => n.date === session);
  const earlier = notes.filter((n) => n !== current);
  const role = (pid: string) => (pid === e.leadId ? 'lead' : pid === e.supervisorId ? 'sup' : m.talentById.get(pid)?.department === 'Operations' ? 'ops' : 'member');
  const roleLabel = { lead: '👑 Leader', sup: '🧭 Supervisor', ops: '⚙️ Operations', member: '' };

  return (
    <div id={'mtg-' + e.id} className="card mtg-project" style={{ ['--rag' as string]: rag?.color ?? 'var(--border)' }}>
      <div className="mtg-project-head">
        <Ring pct={pct} color={rag?.color ?? 'var(--accent)'} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="mtg-project-name">{e.name}</div>
          <div className="mtg-project-meta">{e.client} · {e.sector} · {e.scope}</div>
        </div>
        <div className="mtg-chips mtg-head-chips">
          <span className="mtg-chip">📍 {stageLabel(e.stage)}</span>
          <span className="mtg-chip" style={{ color: rag?.color ?? 'var(--text-faint)' }}>{rag ? `${rag.icon} ${rag.label}` : '⚪ No notes yet'}</span>
          <span className={'mtg-chip' + (last && daysSince(last.date) > STALE_DAYS ? ' stale' : '')}>🗓 {last ? `Updated ${ago(last.date)}` : 'Never updated'}</span>
        </div>
      </div>

      <div className="mtg-team">
        {staffOf(e).map((pid) => {
          const t = m.talentById.get(pid);
          const r = role(pid);
          return (
            <div key={pid} className={'mtg-member ' + r} title={t?.title}>
              <Avatar text={t?.initials ?? '?'} size={26} />
              <div style={{ minWidth: 0 }}>
                <div className="mtg-member-name">{m.name(pid)}</div>
                <div className="mtg-member-role">{roleLabel[r] || t?.title}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mtg-milestones">
        <span className="mtg-label">🏁 Key milestones</span>
        {milestones.map((x) => (
          <button key={x.id} type="button" className="mtg-ms-chip" style={{ ['--ms' as string]: MS[x.status].color }} disabled={!canEdit}
            title={`${MS[x.status].label}${canEdit ? ' — click to edit' : ''}`} onClick={() => modal.open(<MilestoneModal engagementId={e.id} milestone={x} />)}>
            <i>{MS[x.status].icon}</i>{x.title}{x.date && <small>{fmtDate(x.date, { day: '2-digit', month: 'short' })}</small>}
          </button>
        ))}
        {!milestones.length && <span className="small muted">None yet</span>}
        {canEdit && m.bucket(e) === 'active' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => modal.open(<MilestoneModal engagementId={e.id} />)}>+ Milestone</button>}
      </div>

      <div className="mtg-notes-grid">
        {canWrite ? <NoteBox key={e.id + session + (current?.id ?? '')} e={e} session={session} current={current} suggestedRag={last?.rag} /> : (
          current ? <div className="mtg-note-col"><div className="mtg-label">This session · {fmtDate(session)}</div><NoteItem note={current} /></div>
            : <div className="mtg-note-col small muted">{canEdit ? 'This engagement isn’t active, so no new notes.' : 'No notes for this session yet.'}</div>
        )}
        <History e={e} notes={earlier} />
      </div>
    </div>
  );
}

/** Today's notes for one engagement: a single box, saved as this session's note (or updating it). */
function NoteBox({ e, session, current, suggestedRag }: { e: Engagement; session: string; current?: MeetingNote; suggestedRag?: MeetingRag }) {
  const { act } = useWorkspace();
  const modal = useModal();
  const [text, setText] = useState(current?.notes ?? '');
  const [rag, setRag] = useState<MeetingRag>(current?.rag ?? suggestedRag ?? 'on-track');
  const [busy, setBusy] = useState(false);
  const dirty = text.trim() !== (current?.notes ?? '').trim() || rag !== (current?.rag ?? suggestedRag ?? 'on-track');
  const save = async () => {
    setBusy(true);
    await act(() => (current ? api.patch(`/meeting-notes/${current.id}`, { notes: text, rag }) : api.post(`/engagements/${e.id}/meeting-notes`, { date: session, notes: text, rag })), `Notes saved for ${e.name}`);
    setBusy(false);
  };
  return (
    <div className="mtg-note-col">
      <div className="mtg-label">✍️ Notes · session of {fmtDate(session)}{current && <span className="muted"> — saved by {current.createdBy}</span>}</div>
      <textarea className="mtg-textarea" rows={5} value={text} onChange={(x) => setText(x.target.value)}
        placeholder="Where are we now · challenges · next steps · who does what · milestones" />
      {current && noteText(current).filter((p) => p.label).map((p) => <div key={p.label} className="small"><b>{p.label}:</b> {p.text}</div>)}
      <div className="mtg-note-actions">
        <div className="mtg-seg">
          {(Object.keys(RAG) as MeetingRag[]).map((r) => (
            <button key={r} type="button" className={rag === r ? 'on' : ''} style={rag === r ? { background: RAG[r].color, borderColor: RAG[r].color } : undefined} onClick={() => setRag(r)}>{RAG[r].label}</button>
          ))}
        </div>
        <div className="row" style={{ gap: 6 }}>
          {current && <button className="btn btn-ghost btn-sm" title="Delete these notes" onClick={() => modal.open(<Confirm title="Delete these notes?" danger confirmLabel="🗑 Delete" message={<>Delete the {fmtDate(current.date)} notes for <b>{e.name}</b>? You can undo it from the Audit Trail.</>}
            onConfirm={() => act(() => api.del(`/meeting-notes/${current.id}`), 'Notes deleted')} />)}>🗑</button>}
          <button className="btn btn-primary btn-sm" disabled={busy || !dirty || (!text.trim() && !current)} onClick={save}>{busy ? 'Saving…' : !dirty && current ? '✓ Saved' : '💾 Save notes'}</button>
        </div>
      </div>
      {current && <Comments note={current} />}
    </div>
  );
}

/** Notes from earlier sessions, newest first: the latest is shown, the rest on demand. */
function History({ e, notes }: { e: Engagement; notes: MeetingNote[] }) {
  const { model: m } = useWorkspace();
  const toast = useToast();
  const [all, setAll] = useState(false);
  const shown = all ? notes : notes.slice(0, 1);
  const exportCsv = () => {
    const rows = [...notes].reverse().map((n) => ({
      date: n.date, status: RAG[n.rag].label, notes: noteText(n).map((p) => (p.label ? `${p.label}: ` : '') + p.text).join('\n'),
      actions: n.actions.map((a) => `${a.done ? '[x]' : '[ ]'} ${a.task}${a.ownerId ? ' — ' + m.name(a.ownerId) : ''}`).join(' | '),
      comments: n.comments.map((c) => `${c.by}: ${c.text}`).join(' | '), written_by: n.createdBy,
    }));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + toCsv(rows, ['date', 'status', 'notes', 'actions', 'comments', 'written_by'])], { type: 'text/csv;charset=utf-8' }));
    a.download = `${e.name.replace(/[\\/:*?"<>|]+/g, ' ').trim()} - meeting notes.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    toast('Notes downloaded');
  };
  return (
    <div className="mtg-note-col mtg-history">
      <div className="mtg-label">🗂 Previous sessions {notes.length > 0 && <span className="muted">· {notes.length}</span>}
        {notes.length > 0 && <button className="mtg-link-btn" onClick={exportCsv}>⬇ Download</button>}
      </div>
      {notes.length ? (
        <>
          <div className="mtg-timeline">{shown.map((n) => <NoteItem key={n.id} note={n} withComments />)}</div>
          {notes.length > 1 && <button className="mtg-link-btn" onClick={() => setAll(!all)}>{all ? '▴ Show only the latest' : `▾ Show all ${notes.length} sessions`}</button>}
        </>
      ) : <div className="small muted">No earlier sessions yet — notes saved today will show here at the next session.</div>}
    </div>
  );
}

function NoteItem({ note, withComments }: { note: MeetingNote; withComments?: boolean }) {
  const { model: m } = useWorkspace();
  const [open, setOpen] = useState(false);
  const rag = RAG[note.rag];
  return (
    <div className="mtg-note" style={{ ['--rag' as string]: rag.color }}>
      <div className="mtg-note-head"><b>{fmtDate(note.date)}</b><span style={{ color: rag.color }}>{rag.icon} {rag.label}</span><span className="muted">by {note.createdBy}</span></div>
      {noteText(note).map((p, i) => <div key={i} className="mtg-note-text">{p.label && <b>{p.label}: </b>}{p.text}</div>)}
      {note.actions.length > 0 && (
        <ul className="mtg-note-actions-list">
          {note.actions.map((a) => <li key={a.id} className={a.done ? 'done' : ''}>{a.done ? '☑' : '☐'} {a.task}{a.ownerId && <span className="muted"> — {m.name(a.ownerId)}</span>}{a.due && <span className="muted"> · {fmtDate(a.due, { day: '2-digit', month: 'short' })}</span>}</li>)}
        </ul>
      )}
      {withComments && <button className="mtg-link-btn" onClick={() => setOpen(!open)}>💬 {note.comments.length ? `${note.comments.length} comment${note.comments.length > 1 ? 's' : ''}` : 'Comment'}</button>}
      {withComments && open && <Comments note={note} />}
    </div>
  );
}

function Comments({ note }: { note: MeetingNote }) {
  const { canEdit, act, user } = useWorkspace();
  const [text, setText] = useState('');
  const post = async () => { if (text.trim() && (await act(() => api.post(`/meeting-notes/${note.id}/comments`, { text }), 'Comment added'))) setText(''); };
  return (
    <div className="mtg-comments">
      {note.comments.map((c) => (
        <div key={c.id} className="mtg-comment">
          <div className="small"><b>{c.by}</b> <span className="muted">· {fmtDate(c.at, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
            {canEdit && (c.by === user.name || user.role === 'admin') && <button className="mtg-link" onClick={() => act(() => api.del(`/meeting-notes/${note.id}/comments/${c.id}`), 'Comment deleted')}>Delete</button>}
          </div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{c.text}</div>
        </div>
      ))}
      {canEdit && (
        <div className="mtg-comment-new">
          <input placeholder="Add a comment…" value={text} onChange={(x) => setText(x.target.value)} onKeyDown={(x) => { if (x.key === 'Enter') post(); }} />
          <button className="btn btn-sm" disabled={!text.trim()} onClick={post}>Post</button>
        </div>
      )}
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
