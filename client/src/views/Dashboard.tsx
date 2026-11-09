import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bars, Donut, Heatmap, LineChart, StageStrip } from '../components/charts';
import { EngagementListModal, TalentListModal, TalentModal } from '../components/modals';
import { Card, Empty, useModal } from '../components/ui';
import { stageLabel } from '../../../shared/schedule';
import { useModel } from '../lib/workspace';

export const UTIL_BUCKETS = [
  { key: 'Underutilized', label: 'Underutilized (<75%)', color: '#B1A7DA' },
  { key: 'Optimal', label: 'Optimal (75–90%)', color: '#6C68D6' },
  { key: 'At Capacity', label: 'At Capacity (91–100%)', color: '#D48806' },
  { key: 'Overutilized', label: 'Overutilized (>100%)', color: '#ED2429' },
  { key: 'Not Allocated', label: 'Not Allocated', color: '#3A3F63' },
];

export default function Dashboard() {
  const m = useModel();
  const nav = useNavigate();
  const modal = useModal();
  const years = m.trendYears();
  const [year, setYear] = useState(m.now.getUTCFullYear());
  const trend = m.monthlyTrend(year);
  const t = m.talents;
  const kpis = [
    { label: 'Active Engagements', value: m.active.length, icon: '💼', to: '/engagements/status' },
    { label: 'Active Talents', value: t.length, icon: '👥', to: '/talents' },
    { label: 'Firm Utilization', value: m.firmUtilization + '%', icon: '◔', to: '/traffic/capacity' },
    { label: 'Over Capacity', value: t.filter((x) => x.util > 100).length, icon: '⚠', to: '/traffic/monitor', danger: true },
    { label: 'Hiring Gaps', value: m.hiringNeeds().length, icon: '➕', to: '/hiring/forecast' },
  ];
  const stageCounts = Object.fromEntries(m.active.reduce((acc, e) => acc.set(e.stage, (acc.get(e.stage) ?? 0) + 1), new Map<string, number>()));
  const topClients = m.clients().filter((c) => c.active > 0).sort((a, b) => b.active - a.active).slice(0, 5);
  const needy = m.active.find((e) => e.teamIds.length <= 1);
  const recs = needy ? m.recommendations(needy.sector, needy.scope, 3) : [];
  const alerts = m.alerts();
  const featured = [...t].filter((x) => x.department !== 'Operations').sort((a, b) => b.util - a.util).slice(0, 6);
  return (
    <>
      <div className="kpi-grid">
        {kpis.map((k) => (
          <div key={k.label} className="card kpi-card" style={{ cursor: 'pointer' }} onClick={() => nav(k.to)}>
            <div className="kpi-label">{k.label}</div>
            <div className="kpi-row"><div className="kpi-value">{k.value}</div><div className={'kpi-icon' + (k.danger ? ' danger' : '')}>{k.icon}</div></div>
            <span className="kpi-link">View details →</span>
          </div>
        ))}
      </div>
      <div className="row-3">
        <Card title="Utilization trend by month" sub={<select className="inline-input" value={year} onChange={(e) => setYear(Number(e.target.value))}>{years.map((y) => <option key={y}>{y}</option>)}</select>}>
          <LineChart labels={trend.map((x) => x.label)} series={[{ name: `Firm utilization ${year}`, color: '#6C68D6', data: trend.map((x) => x.value) }]} />
          <div className="small muted">From the staffing log where available, otherwise from engagement dates; future months are projected.</div>
        </Card>
        <Card title="Capacity distribution">
          <Donut buckets={UTIL_BUCKETS.map((b) => ({ ...b, count: t.filter((x) => x.utilStatus === b.key).length, members: t.filter((x) => x.utilStatus === b.key).map((x) => `${x.name} · ${x.util}%`) }))}
            onPick={(key, label) => modal.open(<TalentListModal title={label} ids={t.filter((x) => x.utilStatus === key).map((x) => x.id)} />)} />
        </Card>
        <Card title="Alerts" sub={<span style={{ cursor: 'pointer' }} onClick={() => nav('/traffic/monitor')}>Monitor →</span>}>
          {alerts.length ? alerts.slice(0, 6).map((a, i) => (
            <div key={i} className="alert-item" style={{ cursor: a.link ? 'pointer' : undefined }} onClick={() => a.link && nav(a.link)}>
              <div className="alert-ic" style={{ background: a.tone === 'danger' ? 'var(--danger-dim)' : 'var(--accent-glow)', color: a.tone === 'danger' ? 'var(--danger)' : 'var(--accent)' }}>{a.icon}</div>
              <div style={{ flex: 1 }}><div className="alert-title">{a.title}</div><div className="alert-desc">{a.desc}</div></div>
            </div>
          )) : <Empty>✅ No active alerts — all talents and engagements look healthy.</Empty>}
        </Card>
      </div>
      <div className="row-3b">
        <Card title="Engagements by lifecycle stage" sub={<span style={{ cursor: 'pointer' }} onClick={() => nav('/engagements/lifecycle')}>Lifecycle →</span>}>
          <StageStrip counts={stageCounts} onPick={(id) => modal.open(<EngagementListModal title={`In stage: ${stageLabel(id)}`} ids={m.active.filter((e) => e.stage === id).map((e) => e.id)} />)} />
        </Card>
        <Card title="Top clients (active engagements)" sub={<span style={{ cursor: 'pointer' }} onClick={() => nav('/clients')}>Portfolio →</span>}>
          {topClients.length ? <Bars rows={topClients.map((c) => ({ label: c.name, value: c.active }))} /> : <Empty>No active client work.</Empty>}
        </Card>
        <Card title="Recommended talent">
          {needy ? (
            <>
              <div className="small muted" style={{ marginBottom: 8 }}>Understaffed — needs support: <b style={{ color: 'var(--text-dim)' }}>{needy.name}</b> ({needy.sector})</div>
              {recs.map((r) => (
                <div key={r.talent.id} className="talent-rec" style={{ cursor: 'pointer' }} onClick={() => modal.open(<TalentModal id={r.talent.id} />)}>
                  <div className="avatar" style={{ width: 28, height: 28, fontSize: 10 }}>{r.talent.initials}</div>
                  <div style={{ minWidth: 0 }}><div className="trec-name">{r.talent.name}</div><div className="trec-role">{r.reason}</div></div>
                  <div className="trec-fit"><div className="fv">{r.fit}%</div><div className="fl">Fit</div></div>
                </div>
              ))}
            </>
          ) : <Empty>Every active engagement has a team — no staffing gaps.</Empty>}
        </Card>
      </div>
      <div className="row-2">
        <Card title="Utilization heatmap — busiest people" sub={<span style={{ cursor: 'pointer' }} onClick={() => nav('/traffic/capacity')}>All talents →</span>}>
          <div className="table-wrap"><Heatmap model={m} talents={featured} onPick={(id) => modal.open(<TalentModal id={id} />)} /></div>
        </Card>
        <Card title="Quick actions">
          <div className="qa-grid">
            {[['＋', 'New engagement', '/engagements/new'], ['🔁', 'Team suggestions', '/engagements/suggestions'], ['📅', 'Capacity planner', '/traffic/planner'], ['◔', 'Utilization & burnout', '/traffic/monitor'], ['✨', 'Ask the Copilot', '/copilot'], ['⬇', 'Export data', '/reports/export']].map(([ic, label, to]) => (
              <button key={to} className="qa-btn" onClick={() => nav(to)}><div className="qic">{ic}</div>{label}</button>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
