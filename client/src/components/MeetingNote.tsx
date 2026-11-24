/* One meeting note: shown with its status and comments; click it (or ✏️ Edit) to edit in place. */
import { useEffect, useRef, useState } from 'react';
import type { Engagement, MeetingNote, MeetingRag } from '../../../shared/types';
import { api } from '../lib/api';
import { noteText } from '../lib/meetings';
import { useWorkspace } from '../lib/workspace';
import { Confirm, fmtDate, useModal } from './ui';

export const RAG: Record<MeetingRag, { label: string; color: string; icon: string }> = {
  'on-track': { label: 'On track', color: 'var(--ok)', icon: '🟢' },
  'at-risk': { label: 'At risk', color: '#F0A54A', icon: '🟠' },
  'off-track': { label: 'Off track', color: 'var(--danger)', icon: '🔴' },
};

export function RagPicker({ value, onChange }: { value: MeetingRag; onChange: (r: MeetingRag) => void }) {
  return (
    <div className="mtg-seg">
      {(Object.keys(RAG) as MeetingRag[]).map((r) => (
        <button key={r} type="button" className={value === r ? 'on' : ''} style={value === r ? { background: RAG[r].color, borderColor: RAG[r].color } : undefined} onClick={() => onChange(r)}>{RAG[r].label}</button>
      ))}
    </div>
  );
}

export function NoteItem({ note, e, isSession, autoEdit, onDone }: { note: MeetingNote; e: Pick<Engagement, 'name'>; isSession?: boolean; autoEdit?: boolean; onDone?: () => void }) {
  const { model: m, canEdit, act } = useWorkspace();
  const modal = useModal();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note.notes);
  const [rag, setRagState] = useState<MeetingRag>(note.rag);
  const [date, setDate] = useState(note.date);
  const [busy, setBusy] = useState(false);
  const r = RAG[note.rag];
  const box = useRef<HTMLDivElement>(null);
  const startEdit = () => { setText(note.notes || noteText(note).map((p) => (p.label ? `${p.label}: ` : '') + p.text).join('\n')); setRagState(note.rag); setDate(note.date); setEditing(true); };
  // Opened from a link or a click elsewhere (report preview, list, dashboard): go straight to editing.
  useEffect(() => {
    if (!autoEdit) return;
    if (canEdit) startEdit();
    setTimeout(() => box.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
  }, [autoEdit]); // eslint-disable-line react-hooks/exhaustive-deps
  const finish = () => { setEditing(false); onDone?.(); };
  const save = async () => {
    setBusy(true);
    const legacy = !note.notes && (note.whereWeAre || note.challenges || note.nextSteps);
    const ok = await act(() => api.patch(`/meeting-notes/${note.id}`, { notes: text, rag, date, ...(legacy ? { whereWeAre: '', challenges: '', nextSteps: '' } : {}) }), 'Note updated');
    setBusy(false);
    if (ok) finish();
  };
  const remove = () => modal.open(<Confirm title="Delete this note?" danger confirmLabel="🗑 Delete"
    message={<>Delete the {fmtDate(note.date)} note for <b>{e.name}</b>{note.comments.length ? `, with its ${note.comments.length} comment${note.comments.length > 1 ? 's' : ''}` : ''}? You can undo it from the Audit Trail.</>}
    onConfirm={() => act(() => api.del(`/meeting-notes/${note.id}`), 'Note deleted')} />);
  return (
    <div ref={box} className={'mtg-note' + (isSession ? ' this-session' : '') + (autoEdit ? ' picked' : '')} style={{ ['--rag' as string]: (editing ? RAG[rag] : r).color }}>
      <div className="mtg-note-head">
        <b>{fmtDate(note.date)}</b>{isSession && <span className="mtg-today-tag">This session</span>}
        <span style={{ color: r.color }}>{r.icon} {r.label}</span>
        <span className="muted" title={note.editedAt ? `Edited by ${note.editedBy} on ${fmtDate(note.editedAt)}` : undefined}>by {note.createdBy}{note.editedAt ? ` · edited${note.editedBy && note.editedBy !== note.createdBy ? ' by ' + note.editedBy : ''}` : ''}</span>
        {canEdit && !editing && (
          <span className="mtg-note-tools">
            <button type="button" title="Edit this note" onClick={startEdit}>✏️ Edit</button>
            <button type="button" title="Delete this note" className="danger" onClick={remove}>🗑 Delete</button>
          </span>
        )}
      </div>
      {editing ? (
        <div className="mtg-note-edit">
          <textarea className="mtg-textarea" rows={4} value={text} onChange={(x) => setText(x.target.value)} autoFocus />
          <div className="mtg-note-actions">
            <RagPicker value={rag} onChange={setRagState} />
            <input type="date" className="mtg-date" value={date} onChange={(x) => x.target.value && setDate(x.target.value)} title="Session date" />
            <div className="row" style={{ gap: 6, marginLeft: 'auto' }}>
              <button className="btn btn-ghost btn-sm" onClick={finish}>Cancel</button>
              <button className="btn btn-primary btn-sm" disabled={busy || !text.trim()} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className={canEdit ? 'mtg-note-body editable' : 'mtg-note-body'} title={canEdit ? 'Click to edit this note' : undefined}
            role={canEdit ? 'button' : undefined} tabIndex={canEdit ? 0 : undefined} onClick={canEdit ? startEdit : undefined} onKeyDown={(x) => canEdit && x.key === 'Enter' && startEdit()}>
            {noteText(note).map((p, i) => <div key={i} className="mtg-note-text">{p.label && <b>{p.label}: </b>}{p.text}</div>)}
          </div>
          {note.actions.length > 0 && (
            <ul className="mtg-note-actions-list">
              {note.actions.map((a) => <li key={a.id} className={a.done ? 'done' : ''}>{a.done ? '☑' : '☐'} {a.task}{a.ownerId && <span className="muted"> — {m.name(a.ownerId)}</span>}{a.due && <span className="muted"> · {fmtDate(a.due, { day: '2-digit', month: 'short' })}</span>}</li>)}
            </ul>
          )}
        </>
      )}
      <button className="mtg-link-btn" onClick={() => setOpen(!open)}>💬 {note.comments.length ? `${note.comments.length} comment${note.comments.length > 1 ? 's' : ''}` : 'Comment'}</button>
      {open && <Comments note={note} />}
    </div>
  );
}

export function Comments({ note }: { note: MeetingNote }) {
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
