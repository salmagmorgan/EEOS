import { useState } from 'react';
import { fmtMoney } from '../../../shared/engine';
import { Card, ModalFrame, PageHead, useModal } from '../components/ui';
import { downloadFile } from '../lib/api';
import { boardDeckHtml, snapshotHtml } from '../lib/reports';
import { useWorkspace } from '../lib/workspace';

function Preview({ title, html, filename }: { title: string; html: string; filename: string }) {
  return (
    <ModalFrame wide title={title} footer={
      <>
        <button className="btn btn-primary btn-sm" onClick={() => downloadFile(filename, html, 'text/html')}>⬇ Download .html</button>
        <button className="btn btn-sm" onClick={() => { const w = window.open('', '_blank'); if (w) { w.document.write(html); w.document.close(); } }}>Open in new tab (print to PDF)</button>
      </>
    }>
      <iframe title={title} srcDoc={html} style={{ width: '100%', height: '65vh', border: 0, borderRadius: 10, background: '#fff' }} sandbox="allow-modals allow-same-origin" />
    </ModalFrame>
  );
}

export default function Reports() {
  const { model: m, user } = useWorkspace();
  const modal = useModal();
  const [summary, setSummary] = useState<{ title: string; body: string } | null>(null);
  const stamp = new Date().toISOString().slice(0, 10);
  const t = m.talents;
  const fin = m.active.map((e) => m.financials(e)).filter(Boolean);
  const quick: Record<string, () => string> = {
    'Utilization': () => `Firm utilization is ${m.firmUtilization}% across ${t.filter((x) => x.utilStatus !== 'Not Allocated').length} allocated people. ${t.filter((x) => x.utilStatus === 'Overutilized').length} are over capacity, ${t.filter((x) => x.utilStatus === 'At Capacity').length} at capacity, ${t.filter((x) => x.utilStatus === 'Underutilized').length} underutilized and ${t.filter((x) => x.utilStatus === 'Not Allocated').length} unallocated.`,
    'Engagement health': () => `${m.active.length} active engagements: ${['Just Opened', 'Midway', 'About to Close', 'Delayed', 'Complete'].map((h) => `${m.active.filter((e) => m.health(e) === h).length} ${h.toLowerCase()}`).join(', ')}. ${m.active.filter((e) => e.teamIds.length <= 1).length} have only a lead assigned.`,
    'Client portfolio': () => { const c = m.clients(); const top = [...c].sort((a, b) => b.active - a.active)[0]; return `${c.filter((x) => x.active).length} clients have active work, out of ${c.length} relationships on record. Top client by active engagements: ${top?.name ?? '—'} (${top?.active ?? 0}).`; },
    'Financials': () => `${fin.length} active engagements have financials recorded, totalling ${fmtMoney(fin.reduce((s, f) => s + f!.price, 0))} in selling price and ${fmtMoney(fin.reduce((s, f) => s + f!.grossProfit, 0))} gross profit.`,
  };
  return (
    <>
      <PageHead title="Reports Center" desc="On-demand reports built from live data." />
      <div className="row-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Card title="📄 Snapshot summary — one page">
          <p className="small" style={{ color: 'var(--text-dim)', marginBottom: 14 }}>KPIs, utilization trend, capacity split, top risks and hiring gaps on a single printable A4 page for management.</p>
          <button className="btn btn-primary btn-sm" onClick={() => modal.open(<Preview title="Snapshot summary" html={snapshotHtml(m, user.name)} filename={`TBC_EEOS_Snapshot_${stamp}.html`} />)}>Generate snapshot</button>
        </Card>
        <Card title="🖥️ Board summary deck">
          <p className="small" style={{ color: 'var(--text-dim)', marginBottom: 14 }}>Seven 16:9 slides: title, executive summary, portfolio, financials, utilization, team rotation and top clients. Print from the browser for a PDF.</p>
          <button className="btn btn-primary btn-sm" onClick={() => modal.open(<Preview title="Board summary deck" html={boardDeckHtml(m, user.name)} filename={`TBC_EEOS_Board_Deck_${stamp}.html`} />)}>Generate deck</button>
        </Card>
      </div>
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))' }}>
        {Object.keys(quick).map((k) => <Card key={k}><div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>{k} summary</div><button className="btn btn-sm" onClick={() => setSummary({ title: k, body: quick[k]() })}>Generate</button></Card>)}
      </div>
      {summary && <Card title={`${summary.title} summary`} sub="Generated just now"><p style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--text-dim)' }}>{summary.body}</p></Card>}
    </>
  );
}
