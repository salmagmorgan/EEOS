import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { AuditEntry } from '../../../shared/types';
import { Avatar, Card, Empty, PageHead } from '../components/ui';
import { api } from '../lib/api';
import { useWorkspace } from '../lib/workspace';

export default function Audit() {
  const { canEdit, act, data } = useWorkspace();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [who, setWho] = useState('');
  const audit = useQuery({
    queryKey: ['audit', q, who, data.version],
    queryFn: () => api.get<{ entries: AuditEntry[]; people: string[] }>(`/audit?q=${encodeURIComponent(q)}&user=${encodeURIComponent(who)}&limit=300`),
    placeholderData: (prev) => prev,
  });
  const undo = async (id: number) => { await act(() => api.post(`/audit/${id}/undo`), 'Change undone'); qc.invalidateQueries({ queryKey: ['audit'] }); };
  const entries = audit.data?.entries ?? [];
  return (
    <>
      <PageHead title="Audit Trail" desc="Every change, who made it and when — newest first. Editors can undo a change as long as nothing has changed that record since." />
      <div className="filters-bar">
        <input type="text" placeholder="Search person, action, engagement or talent…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={who} onChange={(e) => setWho(e.target.value)}><option value="">All people</option>{audit.data?.people.map((p) => <option key={p}>{p}</option>)}</select>
      </div>
      <Card>
        {entries.length ? entries.map((r) => (
          <div key={r.id} className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start', padding: '9px 4px', borderBottom: '1px solid var(--border-soft)', opacity: r.undoneAt ? 0.5 : 1 }}>
            <Avatar text={r.userName.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase()} size={28} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5 }}><b>{r.userName}</b> — {r.action} {r.entityName && <span style={{ color: 'var(--accent)' }}>{r.entityName}</span>}</div>
              {r.details && <div className="small muted">{r.details}</div>}
              {r.undoneAt && <div className="small" style={{ color: 'var(--warn)' }}>Undone by {r.undoneBy}</div>}
            </div>
            <div className="small muted" style={{ whiteSpace: 'nowrap' }}>{new Date(r.at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
            {canEdit && r.undoable && <button className="btn btn-sm btn-ghost" onClick={() => undo(r.id)}>↩ Undo</button>}
          </div>
        )) : <Empty>{audit.isLoading ? 'Loading…' : 'No audit entries match.'}</Empty>}
        {entries.length === 300 && <div className="small muted" style={{ padding: 10 }}>Showing the latest 300 entries — narrow the search to see older ones.</div>}
      </Card>
    </>
  );
}
