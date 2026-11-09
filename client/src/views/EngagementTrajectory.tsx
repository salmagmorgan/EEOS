import { useState } from 'react';
import { parseDay } from '../../../shared/schedule';
import { EngagementModal } from '../components/modals';
import { Card, Empty, ListRow, PageHead, Stat, Tag, fmtDate, healthClass, useModal } from '../components/ui';
import { useModel } from '../lib/workspace';

export default function EngagementTrajectory() {
  const m = useModel();
  const modal = useModal();
  const [who, setWho] = useState('');
  const [sector, setSector] = useState('');
  const [month, setMonth] = useState('');
  const [status, setStatus] = useState('');
  const monthKey = (s: string) => fmtDate(s, { month: 'short', year: 'numeric' });
  let pool = m.engagements.filter((e) => (!who || m.involves(e, who)) && (!sector || e.sector === sector));
  const months = [...new Set([...pool].sort((a, b) => b.start.localeCompare(a.start)).map((e) => monthKey(e.start)))];
  pool = pool.filter((e) => (!month || monthKey(e.start) === month) && (!status || m.bucket(e) === status)).sort((a, b) => parseDay(b.start).getTime() - parseDay(a.start).getTime());
  return (
    <>
      <PageHead title="Engagement Trajectory" desc="Chronological history of everything the firm has worked on — or one person's own trajectory." />
      <div className="filters-bar">
        <select value={who} onChange={(e) => setWho(e.target.value)}><option value="">🏢 All engagements (company-wide)</option>{m.talents.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
        <select value={sector} onChange={(e) => setSector(e.target.value)}><option value="">All sectors</option>{[...new Set(m.engagements.map((e) => e.sector))].sort().map((s) => <option key={s}>{s}</option>)}</select>
        <select value={month} onChange={(e) => setMonth(e.target.value)}><option value="">All start months</option>{months.map((x) => <option key={x}>{x}</option>)}</select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option><option value="active">Active</option><option value="paused">Paused</option><option value="closed">Closed</option><option value="historical">Historical</option></select>
      </div>
      <Card title={who ? `${m.name(who)} — trajectory` : '🏢 All engagements'} sub="Most recent first">
        <div className="stat-strip">
          <Stat value={pool.length} label="Engagements" />
          <Stat value={pool.filter((e) => m.bucket(e) === 'active').length} label="Currently active" />
          <Stat value={new Set(pool.map((e) => e.client)).size} label="Clients" />
          <Stat value={new Set(pool.map((e) => e.sector)).size} label="Sectors" />
          {who && <Stat value={pool.filter((e) => e.leadId === who).length} label="As lead" />}
        </div>
        {pool.length ? pool.map((e) => {
          const b = m.bucket(e);
          const label = b === 'active' ? m.health(e) : b;
          return <ListRow key={e.id} icon={e.historical ? '📁' : e.leadId === who ? '★' : '💼'} title={e.name} desc={`${e.client} · ${e.sector} · ${e.scope} · Lead: ${m.name(e.leadId)}`}
            right={<div style={{ textAlign: 'right' }}><div className="small muted">{monthKey(e.start)}</div><Tag className={b === 'active' ? healthClass(label) : b === 'paused' ? 'tag-warn' : 'tag-neutral'}>{label}</Tag></div>}
            onClick={() => modal.open(<EngagementModal id={e.id} />)} />;
        }) : <Empty>No engagements match these filters.</Empty>}
      </Card>
    </>
  );
}
