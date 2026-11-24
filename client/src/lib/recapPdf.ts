/* "Engagement Meeting Updates Recap" — a one-page, TBC-branded PDF of the notes from a session.
   Built in the browser (jsPDF, loaded on demand). Layout follows the official TBC guideline:
   black header band with the white TBC monogram and a thin white rule, content on white. */
import type { MeetingRag } from '../../../shared/types';
import { TBC, TBC_STATUS } from '../../../shared/brand';

export interface RecapEngagement {
  name: string;
  client: string;
  leader: string;
  team: string[];
  stage: string;
  rag: MeetingRag | null;
  notes: { text: string; by: string; rag: MeetingRag }[];
  comments: { by: string; text: string }[];
}

/** Where each engagement and note was drawn (points from the page top), so the preview can be clicked. */
export interface RecapRegion { page: number; top: number; bottom: number; item: number; note: number }
export const RECAP_PAGE = { width: 595.28, height: 841.89 };

export interface RecapInput {
  date: string; // YYYY-MM-DD — the session
  preparedBy: string;
  items: RecapEngagement[];
  showTeam: boolean;
}

const RAG_LABEL: Record<MeetingRag, string> = { 'on-track': 'On track', 'at-risk': 'At risk', 'off-track': 'Off track' };

const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
/** The built-in PDF fonts cover Western characters only: drop emoji and other symbols they can't draw. */
const clean = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\x20-\x7E -ÿ–—•…€\n]/g, '').replace(/[ \t]+\n/g, '\n').replace(/ {2,}/g, ' ').replace(/ +([.,;:!?])/g, '$1').trim();
const longDate = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

async function dataUrl(path: string): Promise<{ url: string; w: number; h: number }> {
  const blob = await (await fetch(path)).blob();
  const url = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(blob); });
  const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  return { url, w: img.naturalWidth, h: img.naturalHeight };
}

export function recapFileName(date: string): string {
  return `TBC - Engagement Meeting Updates Recap - ${longDate(date)}.pdf`;
}

export async function buildRecapPdf(input: RecapInput): Promise<{ blob: Blob; regions: RecapRegion[] }> {
  const { jsPDF } = await import('jspdf');
  const mark = await dataUrl('/brand/tbc-mark-white.png');

  const W = 595.28; // A4, points
  const H = 841.89;
  const M = 40; // side margin
  const BAND = 58;
  const FOOT = 34;
  const contentW = W - M * 2;

  /** Lay everything out at a given text size; returns the pages' content (or the height used, when measuring). */
  const regions: RecapRegion[] = [];
  const render = (doc: InstanceType<typeof jsPDF>, size: number, draw: boolean, compact = false) => {
    let page = 1;
    let y = 0;
    const color = (h: string) => doc.setTextColor(...hex(h));
    const header = () => {
      if (!draw) return;
      doc.setFillColor(...hex(TBC.black));
      doc.rect(0, 0, W, BAND, 'F');
      const mh = 17;
      const mw = (mark.w / mark.h) * mh;
      doc.addImage(mark.url, 'PNG', M, (BAND - mh) / 2, mw, mh);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      color(TBC.white);
      const right = 'Engagement Updates';
      const rw = doc.getTextWidth(right);
      doc.text(right, W - M - rw, BAND / 2 + 3.4);
      doc.setDrawColor(...hex(TBC.white));
      doc.setLineWidth(0.6);
      doc.line(M + mw + 12, BAND / 2, W - M - rw - 12, BAND / 2);
    };
    const newPage = () => {
      if (draw) doc.addPage();
      page++;
      header();
      y = BAND + 26;
    };
    const room = H - FOOT - (compact ? 8 : 14);
    const ensure = (h: number) => { if (y + h > room) newPage(); };

    header();
    y = BAND + (compact ? 28 : 34);

    // ---- title block, centred
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(21);
    color(TBC.black);
    if (draw) doc.text('Engagement Meeting Updates Recap', W / 2, y, { align: 'center' });
    y += 18;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    color(TBC.grey);
    if (draw) doc.text(`Session of ${longDate(input.date)}`, W / 2, y, { align: 'center' });
    y += 12;
    if (draw) {
      doc.setDrawColor(...hex(TBC.indigo));
      doc.setLineWidth(1.6);
      doc.line(W / 2 - 22, y, W / 2 + 22, y);
    }
    y += 16;

    // ---- status summary, centred
    const counts = (['on-track', 'at-risk', 'off-track'] as MeetingRag[]).map((r) => [r, input.items.filter((x) => x.rag === r).length] as const).filter(([, n]) => n > 0);
    const summary = [`${input.items.length} engagement${input.items.length === 1 ? '' : 's'}`, ...counts.map(([r, n]) => `${n} ${RAG_LABEL[r].toLowerCase()}`)];
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    const gap = 16;
    const widths = summary.map((t, i) => doc.getTextWidth(t) + (i ? 10 : 0));
    let x = W / 2 - (widths.reduce((a, b) => a + b, 0) + gap * (summary.length - 1)) / 2;
    summary.forEach((t, i) => {
      if (draw) {
        if (i) {
          const r = counts[i - 1][0];
          doc.setFillColor(...hex(TBC_STATUS[r]));
          doc.circle(x + 3, y - 3, 3, 'F');
        }
        color(i ? TBC.black : TBC.grey);
        doc.text(t, x + (i ? 10 : 0), y);
      }
      x += widths[i] + gap;
    });
    y += compact ? 12 : 16;

    // ---- one block per engagement
    const lineH = size * 1.32;
    input.items.forEach((it, idx) => {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(size);
      const notes = it.notes.length
        ? it.notes.map((n) => doc.splitTextToSize((it.notes.length > 1 ? '•  ' : '') + clean(n.text), contentW - 22) as string[])
        : [[`No notes recorded for this session.`]];
      doc.setFontSize(size - 1);
      doc.setFont('helvetica', 'italic');
      const comments = it.comments.map((c) => doc.splitTextToSize(`Comment — ${clean(c.by)}: ${clean(c.text)}`, contentW - 22) as string[]);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(size - 1);
      const meta = compact
        ? [clean(it.client), `Leader: ${clean(it.leader)}`].join('  ·  ')
        : [clean(it.client), `Leader: ${clean(it.leader)}`, clean(it.stage), ...(input.showTeam && it.team.length ? [`Team: ${it.team.map(clean).join(', ')}`] : [])].join('  ·  ');
      const metaLines = compact ? [] : (doc.splitTextToSize(meta, contentW - 22) as string[]);

      const nameH = compact ? size + 3 : size + 6;
      const blockH = nameH + metaLines.length * (lineH - 1) + 5 + notes.reduce((a, l) => a + l.length * lineH + 2, 0) + comments.reduce((a, l) => a + l.length * (lineH - 1) + 1, 0) + 10;
      ensure(Math.min(blockH, room - BAND - 30));
      const top = y;

      if (draw) regions.push({ page, top: y - 2, bottom: y + nameH + 2 + metaLines.length * (lineH - 1) + (compact ? 1 : 4), item: idx, note: -1 });
      // name + status pill
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(size + 2);
      color(TBC.black);
      if (draw) doc.text(clean(it.name), M + 12, y + size);
      if (compact && draw) {
        // client and leader on the same line as the name, cut to the room left before the status pill
        const nameW = doc.getTextWidth(clean(it.name));
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(size - 1);
        color(TBC.grey);
        let t = '   ' + meta;
        const max = contentW - 12 - nameW - 70;
        while (t.length > 4 && doc.getTextWidth(t) > max) t = t.slice(0, -2);
        if (t !== '   ' + meta) t = t.trimEnd() + '…';
        doc.text(t, M + 12 + nameW, y + size);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(size + 2);
      }
      if (it.rag && draw) {
        const label = RAG_LABEL[it.rag].toUpperCase();
        doc.setFontSize(7);
        const pw = doc.getTextWidth(label) + 12;
        doc.setFillColor(...hex(TBC_STATUS[it.rag]));
        doc.roundedRect(W - M - pw, y + size - 9, pw, 12, 6, 6, 'F');
        color(TBC.white);
        doc.text(label, W - M - pw + 6, y + size - 0.6);
      }
      y += nameH + 2;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(size - 1);
      color(TBC.grey);
      metaLines.forEach((l) => { if (draw) doc.text(l, M + 12, y + size - 2); y += lineH - 1; });
      y += compact ? 1 : 4;
      doc.setFontSize(size);
      color(it.notes.length ? TBC.black : TBC.grey);
      if (!it.notes.length) doc.setFont('helvetica', 'italic');
      notes.forEach((lines, ni) => {
        let start = y;
        let startPage = page;
        lines.forEach((l, li) => {
          ensure(lineH);
          if (li === 0 || page !== startPage) { if (page !== startPage && draw) regions.push({ page: startPage, top: start, bottom: room, item: idx, note: it.notes.length ? ni : -1 }); start = y; startPage = page; }
          if (draw) doc.text(l, M + 12 + (l.startsWith('•') ? 0 : it.notes.length > 1 ? 10 : 0), y + size - 1);
          y += lineH;
        });
        if (draw) regions.push({ page, top: start - 2, bottom: y + 1, item: idx, note: it.notes.length ? ni : -1 });
        y += 2;
      });
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(size - 1);
      color(TBC.indigo);
      comments.forEach((lines) => { lines.forEach((l) => { ensure(lineH); if (draw) doc.text(l, M + 12, y + size - 2); y += lineH - 1; }); y += 1; });

      // status bar on the left of the block
      if (draw) {
        doc.setFillColor(...hex(it.rag ? TBC_STATUS[it.rag] : TBC.lavender));
        doc.rect(M, top + 1, 3, Math.max(10, y - top - 2), 'F');
      }
      y += compact ? 5 : 8;
      if (idx < input.items.length - 1 && draw) {
        doc.setDrawColor(...hex('#E4E2EE'));
        doc.setLineWidth(0.6);
        doc.line(M, y - (compact ? 3 : 4), W - M, y - (compact ? 3 : 4));
      }
      y += compact ? 2 : 4;
    });
    return { pages: page, used: y };
  };

  // Fit on one page: try sizes from comfortable to compact; only spill onto more pages if even compact won't fit.
  const measure = new jsPDF({ unit: 'pt', format: 'a4' });
  const tries: [number, boolean][] = [[10.5, false], [10, false], [9.5, false], [9, false], [8.5, false], [8, false], [8.5, true], [8, true], [7.5, true], [7, true], [6.5, true]];
  let [size, compact] = tries[tries.length - 1];
  for (const [s, c] of tries) {
    if (render(measure, s, false, c).pages === 1) { size = s; compact = c; break; }
  }
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  doc.setProperties({ title: `Engagement Meeting Updates Recap — ${longDate(input.date)}`, author: TBC.name, creator: 'EEOS' });
  const { pages } = render(doc, size, true, compact);

  // footer on every page
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setDrawColor(...hex(TBC.grey));
    doc.setLineWidth(0.4);
    doc.line(M, H - FOOT, W - M, H - FOOT);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...hex(TBC.grey));
    doc.text(`${TBC.name}  ·  ${TBC.tagline}`, M, H - FOOT + 13);
    const right = `Prepared by ${clean(input.preparedBy)}  ·  Confidential  ·  Page ${p} of ${pages}`;
    doc.text(right, W - M, H - FOOT + 13, { align: 'right' });
  }
  return { blob: doc.output('blob'), regions };
}
