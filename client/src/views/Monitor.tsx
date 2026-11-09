import { useState } from 'react';
import { TalentModal } from '../components/modals';
import { Card, Empty, PageHead, Stat, Tag, statusClass, statusColor, useModal } from '../components/ui';
import { api } from '../lib/api';
import { useWorkspace } from '../lib/workspace';

export default function Monitor() {
  const { model: m, canEdit, act } = useWorkspace();
  const modal = useModal();
  const [f, setF] = useState('');
  const [q, setQ] = useState('');
  const all = m.talents;
  const rows = all.filter((t) => {
    if (q && !(t.name + ' ' + t.title).toLowerCase().includes(q.toLowerCase())) return false;
    if (f === 'over') return t.util > 100;
    if (f === 'atcap') return t.utilStatus === 'At Capacity';
    if (f === 'under') return t.utilStatus === 'Underutilized';
    if (f === 'none') return t.utilStatus === 'Not Allocated';
    if (f === 'flagged') return !!t.flag;
    return true;
  }).sort((a, b) => b.util - a.util);
  return (
    <>
      <PageHead title="Utilization Monitor & Burnout Alerts" desc="Traffic-light view of everyone's live utilization, computed from active engagement assignments." />
      <div className="stat-strip">
        <Stat value={all.filter((t) => t.util > 100).length} label="Overutilized" color="var(--danger)" onClick={() => setF('over')} />
        <Stat value={all.filter((t) => t.utilStatus === 'At Capacity').length} label="At capacity" color="var(--warn)" onClick={() => setF('atcap')} />
        <Stat value={all.filter((t) => t.utilStatus === 'Optimal').length} label="Optimal" color="var(--accent)" onClick={() => setF('')} />
        <Stat value={all.filter((t) => t.utilStatus === 'Underutilized').length} label="Underutilized" color="var(--lavender)" onClick={() => setF('under')} />
        <Stat value={all.filter((t) => t.utilStatus === 'Not Allocated').length} label="Not allocated" onClick={() => setF('none')} />
        <Stat value={all.filter((t) => t.flag).length} label="Flagged" color="var(--warn)" onClick={() => setF('flagged')} />
      </div>
      <div className="filters-bar">
        <select value={f} onChange={(e) => setF(e.target.value)}><option value="">Everyone</option><option value="over">Over capacity (&gt;100%)</option><option value="atcap">At capacity (91–100%)</option><option value="under">Underutilized (&lt;75%)</option><option value="none">Not allocated</option><option value="flagged">Flagged</option></select>
        <input type="text" placeholder="Search talent…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <Card>
        <div className="table-wrap">
          {rows.length ? (
            <table className="data">
              <thead><tr><th>Talent</th><th>Title</th><th>Department</th><th>Status</th><th style={{ width: 200 }}>Utilization</th><th>Action</th></tr></thead>
              <tbody>{rows.map((t) => (
                <tr key={t.id} onClick={() => modal.open(<TalentModal id={t.id} />)}>
                  <td><b>{t.name}</b>{t.utilOverride && <span title="Manually overridden" style={{ color: 'var(--warn)' }}> ✋</span>}{t.flag && ' 🚩'}</td>
                  <td>{t.title}</td><td><Tag className="tag-neutral">{t.department}</Tag></td>
                  <td><Tag className={statusClass(t.utilStatus)}>{t.utilStatus}</Tag></td>
                  <td><div className="progress-mini" style={{ width: 140 }}><div style={{ width: Math.min(100, t.util) + '%', background: statusColor(t.utilStatus) }} /></div> {t.util}%</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {t.flag && <Tag className="tag-warn">Flagged by {t.flag.by}</Tag>}{' '}
                    {canEdit && <button className={'btn btn-sm ' + (t.flag ? '' : 'btn-danger-outline')} onClick={() => act(() => api.put(`/talents/${t.id}/flag`, { flagged: !t.flag }), t.flag ? `${t.name} unflagged` : `${t.name} flagged for reallocation`)}>{t.flag ? 'Unflag' : 'Flag for reallocation'}</button>}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          ) : <Empty>No one matches this filter.</Empty>}
        </div>
      </Card>
    </>
  );
}
