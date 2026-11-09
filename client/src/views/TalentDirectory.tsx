import { useState } from 'react';
import { DEPARTMENTS, SECTORS } from '../../../shared/constants';
import { UTIL_STATUSES } from '../../../shared/engine';
import { AddTalentModal, TalentModal } from '../components/modals';
import { Avatar, Card, Empty, PageHead, Tag, statusClass, statusColor, useModal } from '../components/ui';
import { useWorkspace } from '../lib/workspace';

export default function TalentDirectory() {
  const { model: m, canEdit } = useWorkspace();
  const modal = useModal();
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('');
  const [sector, setSector] = useState('');
  const [status, setStatus] = useState('');
  const rows = m.talents.filter((t) => (!q || (t.name + ' ' + t.title).toLowerCase().includes(q.toLowerCase())) && (!dept || t.department === dept) && (!sector || t.sectors.includes(sector)) && (!status || t.utilStatus === status));
  return (
    <>
      <PageHead title="Talent Directory" desc={`${m.talents.length} people on the roster — ${DEPARTMENTS.map((d) => `${d}: ${m.talents.filter((t) => t.department === d).length}`).join(' · ')}`} />
      <div className="filters-bar">
        <input type="text" placeholder="Search name or title…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={dept} onChange={(e) => setDept(e.target.value)}><option value="">All departments</option>{DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}</select>
        <select value={sector} onChange={(e) => setSector(e.target.value)}><option value="">Any sector experience</option>{SECTORS.map((s) => <option key={s}>{s}</option>)}</select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{UTIL_STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
        {canEdit && <button className="btn btn-primary btn-sm" onClick={() => modal.open(<AddTalentModal />)}>＋ Add talent</button>}
      </div>
      <Card>
        <div className="table-wrap">
          {rows.length ? (
            <table className="data">
              <thead><tr><th>Talent</th><th>Title</th><th>Department</th><th>Engagements / capacity</th><th>Utilization</th><th>Status</th><th>Sectors</th></tr></thead>
              <tbody>{rows.map((t) => (
                <tr key={t.id} onClick={() => modal.open(<TalentModal id={t.id} />)}>
                  <td><div className="row" style={{ flexWrap: 'nowrap' }}><Avatar text={t.initials} />{t.name}{t.flag && ' 🚩'}</div></td>
                  <td>{t.title}</td><td><Tag className="tag-neutral">{t.department}</Tag></td>
                  <td>{t.engagementCount} / {t.projectCapacity}</td>
                  <td><b style={{ color: statusColor(t.utilStatus) }}>{t.util}%</b>{t.utilOverride && ' ✋'}</td>
                  <td><Tag className={statusClass(t.utilStatus)}>{t.utilStatus}</Tag></td>
                  <td className="small muted">{t.sectors.slice(0, 3).join(', ')}{t.sectors.length > 3 && ` +${t.sectors.length - 3}`}</td>
                </tr>
              ))}</tbody>
            </table>
          ) : <Empty>No talents match your filters.</Empty>}
        </div>
      </Card>
    </>
  );
}
