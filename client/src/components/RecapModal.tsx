/* Engagement Meeting Updates Recap: choose the session and engagements, see the PDF exactly as it
   will be exported, then download or share it. Used on the meeting page and in the Export Center. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { stageLabel } from '../../../shared/schedule';
import type { MeetingNote } from '../../../shared/types';
import { noteText, staffOf, useMeetingData } from '../lib/meetings';
import { buildRecapPdf, recapFileName, RECAP_PAGE, type RecapRegion } from '../lib/recapPdf';
import { useWorkspace } from '../lib/workspace';
import { NoteItem } from './MeetingNote';
import { ModalFrame, useToast } from './ui';

const today = () => new Date().toISOString().slice(0, 10);

/** The notes-report icon (a TBC page with notes lines), used wherever the recap can be exported. */
export function NotesReportIcon({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 40 48" width={size * 0.84} height={size} aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M4 2h22l10 10v32a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="#100F0D" stroke="#B1A7DA" strokeWidth="2.4" />
      <path d="M26 2v10h10" fill="none" stroke="#B1A7DA" strokeWidth="2.4" />
      <rect x="8" y="17" width="20" height="3.4" rx="1.7" fill="#FFFFFF" />
      <rect x="8" y="24" width="24" height="2.8" rx="1.4" fill="#4A49A7" />
      <rect x="8" y="29.5" width="18" height="2.8" rx="1.4" fill="#4A49A7" />
      <rect x="8" y="35" width="21" height="2.8" rx="1.4" fill="#ED2429" />
    </svg>
  );
}

/** Draws a PDF's pages onto canvases (pdf.js, loaded on demand) — works the same on phones and computers. */
function PdfPreview({ file, busy, onPick, editable }: { file: File | null; busy: boolean; onPick?: (page: number, y: number) => void; editable?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState(0);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!file || !box.current) return;
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
        const worker = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
        if (cancelled || !box.current) return;
        const host = box.current;
        const width = host.clientWidth - 2;
        const canvases: HTMLCanvasElement[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const base = page.getViewport({ scale: 1 });
          const scale = (width / base.width) * Math.min(2, window.devicePixelRatio || 1);
          const vp = page.getViewport({ scale });
          const c = document.createElement('canvas');
          c.width = vp.width;
          c.height = vp.height;
          c.style.width = '100%';
          c.className = 'recap-page' + (editable ? ' editable' : '');
          c.title = editable ? 'Click a note to edit it' : '';
          c.dataset.page = String(i);
          await page.render({ canvasContext: c.getContext('2d')!, viewport: vp }).promise;
          canvases.push(c);
        }
        if (cancelled) return;
        host.replaceChildren(...canvases);
        setPages(pdf.numPages);
        setErr('');
      } catch (e) {
        if (!cancelled) setErr((e as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, [file]);
  return (
    <div className="recap-preview-wrap">
      <div className="recap-preview-head">
        <span>Preview{pages ? ` · ${pages} page${pages > 1 ? 's' : ''}` : ''}</span>
        {busy && <span className="muted">Updating…</span>}
      </div>
      {err && <div className="small" style={{ color: 'var(--danger)' }}>Preview unavailable ({err}) — the download still works.</div>}
      {editable && file && <div className="recap-hint">✏️ Click any note on the page to edit it</div>}
      <div ref={box} className={'recap-preview' + (busy ? ' busy' : '')} onClick={(x) => {
        const c = (x.target as HTMLElement).closest('canvas');
        if (!c || !onPick) return;
        const r = c.getBoundingClientRect();
        onPick(Number(c.dataset.page), ((x.clientY - r.top) / r.height) * RECAP_PAGE.height);
      }}>{!file && <div className="recap-preview-empty">Choose at least one engagement to see the preview.</div>}</div>
    </div>
  );
}

export function RecapModal({ session, only, order }: { session?: string; only?: string; notesFor?: (id: string) => MeetingNote[]; order?: string[] }) {
  const { model: m, user, data, canEdit } = useWorkspace();
  const { notesFor } = useMeetingData();
  const [regions, setRegions] = useState<RecapRegion[]>([]);
  const [editing, setEditing] = useState<{ eng: string; note: string } | null>(null);
  const toast = useToast();
  const [date, setDate] = useState(session ?? today());
  const withNotes = (id: string) => notesFor(id).some((n) => n.date === date);
  const candidates = useMemo(() => {
    const ids = new Set([...m.engagements.filter((e) => m.bucket(e) === 'active').map((e) => e.id), ...m.engagements.filter((e) => e.status !== 'deleted' && withNotes(e.id)).map((e) => e.id)]);
    const rank = new Map((order ?? []).map((id, i) => [id, i]));
    // Active engagements first (in the meeting page's order), then closed/paused ones that have notes that day.
    const act = (id: string) => (m.bucket(m.engagement(id)!) === 'active' ? 0 : 1);
    return [...ids].map((id) => m.engagement(id)!).filter(Boolean).sort((a, b) => act(a.id) - act(b.id) || (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999) || a.name.localeCompare(b.name));
  }, [m, date, order, notesFor]); // eslint-disable-line react-hooks/exhaustive-deps
  const defaults = () => candidates.filter((e) => m.bucket(e) === 'active' || withNotes(e.id)).map((e) => e.id);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(only ? [only] : defaults()));
  const firstDate = useRef(true);
  useEffect(() => {
    if (firstDate.current) { firstDate.current = false; return; }
    if (!only) setPicked(new Set(defaults()));
  }, [date]); // eslint-disable-line react-hooks/exhaustive-deps
  const [comments, setComments] = useState(true);
  const [team, setTeam] = useState(true);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const chosen = candidates.filter((e) => picked.has(e.id));
  const datesWithNotes = useMemo(() => [...new Set(m.engagements.flatMap((e) => notesFor(e.id).map((n) => n.date)))].sort().reverse().slice(0, 8), [m, notesFor]);

  // Rebuild the PDF (and its preview) shortly after any change.
  const key = `${date}|${chosen.map((e) => e.id).join(',')}|${comments}|${team}|${data.version}`;
  useEffect(() => {
    if (!chosen.length) { setFile(null); return; }
    let cancelled = false;
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const items = chosen.map((e) => {
          const day = notesFor(e.id).filter((n) => n.date === date).reverse(); // oldest first, as written
          return {
            name: e.name, client: e.client, leader: m.name(e.leadId), stage: stageLabel(e.stage),
            team: staffOf(e).filter((x) => x !== e.leadId).map((x) => m.name(x)),
            rag: day.length ? day[day.length - 1].rag : null,
            notes: day.map((n) => ({ text: noteText(n).map((p) => (p.label ? `${p.label.replace(/^\S+\s/, '')}: ` : '') + p.text).join('\n'), by: n.createdBy, rag: n.rag })),
            comments: comments ? day.flatMap((n) => n.comments.map((c) => ({ by: c.by, text: c.text }))) : [],
          };
        });
        const out = await buildRecapPdf({ date, preparedBy: user.name, items, showTeam: team });
        if (!cancelled) { setFile(new File([out.blob], recapFileName(date), { type: 'application/pdf' })); setRegions(out.regions); }
      } catch (err) {
        if (!cancelled) toast('Could not create the PDF: ' + (err as Error).message, 'error');
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  // Click on the preview: find the note drawn there and open it for editing.
  const pick = (page: number, y: number) => {
    const hits = regions.filter((r) => r.page === page && y >= r.top - 3 && y <= r.bottom + 3);
    const hit = hits.find((r) => r.note >= 0) ?? hits[0];
    if (!hit) return;
    const e = chosen[hit.item];
    if (!e) return;
    const day = notesFor(e.id).filter((n) => n.date === date).reverse();
    const note = day[hit.note >= 0 ? hit.note : 0];
    if (!note) { toast(`${e.name} has no notes on this date — add one on the meeting page.`, 'error'); return; }
    setEditing({ eng: e.id, note: note.id });
  };
  const editingEng = editing ? m.engagement(editing.eng) : null;
  const editingNote = editing ? notesFor(editing.eng).find((n) => n.id === editing.note) : null;

  const download = () => {
    if (!file) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 20_000);
    toast('Recap PDF downloaded');
  };
  const canShare = typeof navigator !== 'undefined' && typeof navigator.canShare === 'function';
  const share = async () => {
    if (!file) return;
    try {
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: 'Engagement Meeting Updates Recap' });
      else download();
    } catch { /* the person closed the share sheet */ }
  };

  return (
    <ModalFrame wide title={<span className="row" style={{ gap: 10, flexWrap: 'nowrap' }}><NotesReportIcon size={22} /> Engagement Meeting Updates Recap</span>} footer={<>
      {canShare && <button className="btn btn-sm" disabled={busy || !file} onClick={share}>📤 Share</button>}
      <button className="btn btn-primary btn-sm" disabled={busy || !file} onClick={download}>{busy ? 'Preparing…' : '⬇ Export PDF'}</button>
    </>}>
      <div className="recap-layout">
        <div className="recap-options">
          {editingEng && editingNote && (
            <div className="recap-editing">
              <div className="mtg-label">✏️ Editing · {editingEng.name}<button className="mtg-link-btn" onClick={() => setEditing(null)}>Done</button></div>
              <NoteItem key={editingNote.id} note={editingNote} e={editingEng} autoEdit onDone={() => setEditing(null)} />
            </div>
          )}
          <div className="form-field"><label>Session date</label><input type="date" value={date} onChange={(x) => x.target.value && setDate(x.target.value)} /></div>
          {datesWithNotes.length > 0 && (
            <div className="recap-dates">
              {datesWithNotes.map((d) => <button key={d} type="button" className={'mtg-qchip' + (d === date ? ' on' : '')} onClick={() => setDate(d)}>{new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' })}</button>)}
            </div>
          )}
          <div className="form-field" style={{ marginTop: 10 }}><label>Include</label>
            <label className="mtg-check"><input type="checkbox" checked={comments} onChange={(x) => setComments(x.target.checked)} /> Comments on the notes</label>
            <label className="mtg-check"><input type="checkbox" checked={team} onChange={(x) => setTeam(x.target.checked)} /> Team members</label>
          </div>
          <div className="mtg-label" style={{ margin: '14px 0 6px' }}>Engagements · {chosen.length}
            <button className="mtg-link-btn" onClick={() => setPicked(new Set(defaults()))}>All active</button>
            <button className="mtg-link-btn" onClick={() => setPicked(new Set(candidates.filter((e) => withNotes(e.id)).map((e) => e.id)))}>Only with notes</button>
            <button className="mtg-link-btn" onClick={() => setPicked(new Set())}>None</button>
          </div>
          <div className="mtg-recap-list">
            {candidates.map((e) => {
              const n = notesFor(e.id).filter((x) => x.date === date).length;
              return (
                <label key={e.id} className={'mtg-recap-item' + (picked.has(e.id) ? ' on' : '')}>
                  <input type="checkbox" checked={picked.has(e.id)} onChange={() => toggle(e.id)} />
                  <span className="mtg-recap-name">{e.name}</span>
                  <span className={n ? 'mtg-recap-n' : 'mtg-recap-n none'}>{n ? `${n} note${n > 1 ? 's' : ''}` : 'no notes'}</span>
                </label>
              );
            })}
          </div>
        </div>
        <PdfPreview file={file} busy={busy} onPick={canEdit ? pick : undefined} editable={canEdit} />
      </div>
    </ModalFrame>
  );
}
