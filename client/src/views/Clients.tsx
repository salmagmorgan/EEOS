import { useState } from 'react';
import { ClientModal } from '../components/modals';
import { Avatar, Empty, PageHead, useModal } from '../components/ui';
import { useModel } from '../lib/workspace';

export default function Clients() {
  const m = useModel();
  const modal = useModal();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('');
  const clients = m.clients()
    .filter((c) => (!q || (c.name + ' ' + c.owner + ' ' + c.industry).toLowerCase().includes(q.toLowerCase())) && (filter !== 'active' || c.active > 0))
    .sort((a, b) => b.active - a.active || b.historical - a.historical || a.name.localeCompare(b.name));
  return (
    <>
      <PageHead title="Client Portfolio & Relationships" desc="Every client relationship — engagement history and relationship ownership together." />
      <div className="filters-bar">
        <input type="text" placeholder="Search clients, owners, industries…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="">All clients</option><option value="active">With active work</option></select>
      </div>
      {clients.length ? clients.map((c) => (
        <div key={c.id} className="card" style={{ marginBottom: 12, cursor: 'pointer' }} onClick={() => modal.open(<ClientModal id={c.id} />)}>
          <div className="row" style={{ flexWrap: 'nowrap', gap: 14 }}>
            <Avatar text={c.name.slice(0, 2).toUpperCase()} size={44} />
            <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 14, fontWeight: 700 }}>{c.name}</div><div className="small muted">{c.industry} · {c.country} · Owner: {c.owner}</div></div>
            <div style={{ textAlign: 'center' }}><div style={{ fontFamily: 'Sora', fontSize: 18, fontWeight: 800, color: c.active ? 'var(--ok)' : 'var(--text-faint)' }}>{c.active}</div><div className="small muted">ACTIVE</div></div>
            <div style={{ textAlign: 'center' }}><div style={{ fontFamily: 'Sora', fontSize: 18, fontWeight: 800, color: 'var(--text-dim)' }}>{c.historical}</div><div className="small muted">PAST</div></div>
          </div>
        </div>
      )) : <Empty>No clients match.</Empty>}
    </>
  );
}
