import { useState } from 'react';
import { fmtMoney } from '../../../shared/engine';
import { Bars } from '../components/charts';
import { EngagementModal } from '../components/modals';
import { Card, Empty, PageHead, Stat, Tag, useModal } from '../components/ui';
import { useModel } from '../lib/workspace';

export default function Profitability() {
  const m = useModel();
  const modal = useModal();
  const [only, setOnly] = useState('');
  const rows = m.engagements.map((e) => ({ e, f: m.financials(e)! })).filter((r) => r.f).sort((a, b) => b.f.profitabilityPct - a.f.profitabilityPct);
  const shown = only ? rows.filter((r) => r.e.id === only) : rows;
  const revenue = shown.reduce((s, r) => s + r.f.price, 0);
  const profit = shown.reduce((s, r) => s + r.f.grossProfit, 0);
  const margin = revenue ? Math.round((profit / revenue) * 1000) / 10 : 0;
  const color = (p: number) => (p >= 30 ? '#4FC98A' : p >= 10 ? '#F47381' : '#ED2429');
  return (
    <>
      <PageHead title="Engagement Profitability" desc="Selling price and cost are entered per engagement (from its detail card); gross profit and margin are computed. Margin below is revenue-weighted." />
      <div className="filters-bar">
        <select value={only} onChange={(e) => setOnly(e.target.value)}><option value="">All engagements with financials</option>{rows.map((r) => <option key={r.e.id} value={r.e.id}>{r.e.name}</option>)}</select>
      </div>
      <div className="stat-strip">
        <Stat value={shown.length} label="Engagements tracked" />
        <Stat value={fmtMoney(revenue)} label="Total selling price" />
        <Stat value={fmtMoney(profit)} label="Gross profit" color={profit >= 0 ? 'var(--ok)' : 'var(--danger)'} />
        <Stat value={margin + '%'} label="Margin" />
      </div>
      <Card title="Margin by engagement" style={{ marginBottom: 16 }}>
        {shown.length ? <Bars labelWidth={180} suffix="%" rows={shown.map((r) => ({ key: r.e.id, label: r.e.name, value: r.f.profitabilityPct, color: color(r.f.profitabilityPct) }))} onPick={(id) => modal.open(<EngagementModal id={id} />)} />
          : <Empty>No financials recorded yet. Open any engagement and add a selling price and cost.</Empty>}
      </Card>
      {shown.length > 0 && (
        <Card>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Engagement</th><th>Client</th><th>Status</th><th>Selling price</th><th>Cost</th><th>Gross profit</th><th>Margin</th></tr></thead>
              <tbody>{shown.map(({ e, f }) => (
                <tr key={e.id} onClick={() => modal.open(<EngagementModal id={e.id} />)}>
                  <td><b>{e.name}</b></td><td>{e.client}</td><td>{m.bucket(e)}</td><td>{fmtMoney(f.price)}</td><td>{fmtMoney(f.cost)}</td>
                  <td style={{ color: f.grossProfit >= 0 ? 'var(--ok)' : 'var(--danger)' }}>{fmtMoney(f.grossProfit)}</td>
                  <td><Tag className={f.profitabilityPct >= 30 ? 'tag-ok' : f.profitabilityPct >= 10 ? 'tag-warn' : 'tag-danger'}>{f.profitabilityPct}%</Tag></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
