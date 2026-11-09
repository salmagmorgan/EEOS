import { useState } from 'react';
import { LIFECYCLE } from '../../../shared/constants';
import { HEALTH_VALUES, stageLabel } from '../../../shared/schedule';
import type { Engagement } from '../../../shared/types';
import { Bars } from '../components/charts';
import { EngagementListModal, EngagementModal } from '../components/modals';
import { Card, Confirm, Empty, PageHead, Stat, Tag, healthClass, priorityClass, useModal } from '../components/ui';
import { api } from '../lib/api';
import { useWorkspace } from '../lib/workspace';

export default function Status() {
  const { model: m, canEdit, act } = useWorkspace();
  const modal = useModal();
  const [q, setQ] = useState('');
  const [client, setClient] = useState('');
  const [stage, setStage] = useState('');
  const [health, setHealth] = useState('');
  const [status, setStatus] = useState('active');
  const [sort, setSort] = useState('');
  const [sectorsOpen, setSectorsOpen] = useState(true);
  const b = m.yearBuckets();
  const show = (title: string, list: Engagement[], blurb: string) => modal.open(<EngagementListModal title={title} blurb={blurb} ids={list.map((e) => e.id)} />);
  const sectors = m.sectorDistribution();

  let rows = m.engagements.filter((e) => {
    const bucket = m.bucket(e);
    if (status !== 'all' && bucket !== status) return false;
    if (q && !(e.name + ' ' + e.client).toLowerCase().includes(q.toLowerCase())) return false;
    if (client && e.client !== client) return false;
    if (stage && e.stage !== stage) return false;
    if (health && (bucket !== 'active' || m.health(e) !== health)) return false;
    return true;
  });
  if (sort === 'lead') rows = [...rows].sort((a, c) => m.name(a.leadId).localeCompare(m.name(c.leadId)) || a.name.localeCompare(c.name));
  if (sort === 'end') rows = [...rows].sort((a, c) => a.end.localeCompare(c.end));
  rows = [...rows].sort((a, c) => Number(m.health(a) === 'Complete') - Number(m.health(c) === 'Complete'));
  const doAction = (e: Engagement, action: string, msg: string, confirm?: string) => {
    const run = () => act(() => api.post(`/engagements/${e.id}/${action}`), msg);
    if (confirm) modal.open(<Confirm title={confirm} danger confirmLabel="Yes" message={<><b>{e.name}</b> — {action === 'delete' ? 'deleting is for mistakes and duplicates; it can be restored from Data Management.' : 'it will stop counting toward utilization and KPIs. You can reopen it later.'}</>} onConfirm={run} />);
    else run();
  };

  return (
    <>
      <PageHead title="Engagement Status" desc="The full portfolio. Historical engagements imported from the staffing log are read-only." />
      <Card title={`📊 ${b.year} completions`} style={{ marginBottom: 16 }}>
        <div className="stat-strip" style={{ marginBottom: 14 }}>
          <Stat value={b.total.length} label={`Projects in ${b.year}`} onClick={() => show(`All ${b.year} projects`, b.total, `Start or end date in ${b.year}.`)} />
          <Stat value={b.completed.length} label="Completed" color="var(--ok)" onClick={() => show(`Completed in ${b.year}`, b.completed, 'Closed or historical, ending this year.')} />
          <Stat value={b.active.length} label="Still active" color="var(--accent)" onClick={() => show(`Still active`, b.active, 'Neither closed nor paused.')} />
          <Stat value={b.readyToClose.length} label="Ready to close" color="var(--warn)" onClick={() => show('Ready to close', b.readyToClose, 'Reached their final stage but not yet formally closed.')} />
          <Stat value={b.paused.length} label="Paused" color="var(--warn)" onClick={() => show('Paused', b.paused, 'Not counted as active anywhere.')} />
          <Stat value={b.closed.length} label="Manually closed" onClick={() => show('Manually closed', b.closed, '')} />
          <Stat value={b.historical.length} label="Historical" onClick={() => show('Historical records', b.historical, 'From the imported staffing log.')} />
          <Stat value={b.completionRate + '%'} label="Completion rate" />
        </div>
        <div className="row small" style={{ justifyContent: 'space-between', color: 'var(--text-dim)' }}><span>{b.year} progress</span><span>{b.yearPct}% of the year elapsed</span></div>
        <div className="progress-mini" style={{ height: 10, width: '100%' }}><div style={{ width: b.yearPct + '%' }} /></div>
      </Card>
      <Card title="🏢 Sector distribution — all time" sub={<span style={{ cursor: 'pointer' }} onClick={() => setSectorsOpen(!sectorsOpen)}>{sectorsOpen ? '− Minimize' : '+ Expand'}</span>} style={{ marginBottom: 16 }}>
        {sectorsOpen && (
          <>
            <div className="row" style={{ alignItems: 'baseline', marginBottom: 12 }}>
              <div style={{ fontFamily: 'Sora', fontSize: 34, fontWeight: 800, color: 'var(--accent)' }}>{sectors.length}</div>
              <div className="small muted" style={{ textTransform: 'uppercase' }}>sectors across {m.engagements.length} engagements</div>
            </div>
            <Bars labelWidth={140} rows={sectors.map((s) => ({ label: s.sector, value: s.engagements.length }))} onPick={(k) => show(`🏢 ${k}`, sectors.find((s) => s.sector === k)!.engagements, 'Active and historical combined.')} />
          </>
        )}
      </Card>
      <div className="filters-bar">
        <input type="text" placeholder="Search engagements…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={client} onChange={(e) => setClient(e.target.value)}><option value="">All clients</option>{[...new Set(m.engagements.map((e) => e.client))].sort().map((c) => <option key={c}>{c}</option>)}</select>
        <select value={stage} onChange={(e) => setStage(e.target.value)}><option value="">All stages</option>{LIFECYCLE.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
        <select value={health} onChange={(e) => setHealth(e.target.value)}><option value="">All health</option>{HEALTH_VALUES.map((h) => <option key={h}>{h}</option>)}</select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="active">Active</option><option value="paused">Paused</option><option value="closed">Closed</option><option value="historical">Historical</option><option value="all">All</option></select>
        <select value={sort} onChange={(e) => setSort(e.target.value)}><option value="">Default order</option><option value="lead">By lead</option><option value="end">By end date</option></select>
      </div>
      <Card>
        <div className="table-wrap">
          {rows.length ? (
            <table className="data">
              <thead><tr><th>Engagement</th><th>Status</th><th>Client</th><th>Stage</th><th>Lead</th><th>Health</th><th>Priority</th><th>Timeline</th>{canEdit && <th>Action</th>}</tr></thead>
              <tbody>
                {rows.map((e) => {
                  const bucket = m.bucket(e);
                  const info = m.schedule(e);
                  const h = m.health(e);
                  return (
                    <tr key={e.id} onClick={() => modal.open(<EngagementModal id={e.id} />)}>
                      <td><b>{e.name}</b></td>
                      <td><Tag className={bucket === 'active' ? 'tag-ok' : bucket === 'paused' ? 'tag-warn' : 'tag-neutral'}>{bucket}</Tag></td>
                      <td>{e.client}</td><td>{stageLabel(e.stage)}</td><td>{m.name(e.leadId)}</td>
                      <td>{bucket === 'active' ? <Tag className={healthClass(h)}>{h}</Tag> : '—'}</td>
                      <td>{bucket === 'active' ? <Tag className={priorityClass(m.priority(e))}>{m.priority(e)}</Tag> : '—'}</td>
                      <td>{bucket !== 'active' || !info ? '—' : info.isComplete ? <Tag className="tag-ok">✅ Complete</Tag> : <Tag className={info.daysLeft < 0 ? 'tag-danger' : info.closingSoon ? 'tag-warn' : 'tag-neutral'}>{info.daysLeft < 0 ? `${-info.daysLeft}d overdue` : `${info.daysLeft}d left`}</Tag>}</td>
                      {canEdit && (
                        <td onClick={(x) => x.stopPropagation()}>
                          {bucket === 'historical' ? <span className="small muted">Read only</span> : (
                            <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                              {bucket === 'active' && <button className="btn btn-sm" onClick={() => doAction(e, 'pause', 'Paused')}>⏸</button>}
                              {bucket === 'paused' && <button className="btn btn-sm" onClick={() => doAction(e, 'resume', 'Resumed')}>▶</button>}
                              {bucket === 'closed' && <button className="btn btn-sm" onClick={() => doAction(e, 'reopen', 'Reopened')}>↺ Reopen</button>}
                              {bucket !== 'closed' && <button className="btn btn-sm btn-danger-outline" onClick={() => doAction(e, 'close', 'Closed', 'Close engagement?')}>🔒 Close</button>}
                              <button className="btn btn-sm btn-danger-outline" title="Delete" onClick={() => doAction(e, 'delete', 'Deleted', 'Delete engagement?')}>🗑</button>
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : <Empty>No engagements match your filters.</Empty>}
        </div>
      </Card>
    </>
  );
}
