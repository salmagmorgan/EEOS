import { useState } from 'react';
import { WORKLOAD_TIERS, WORKLOAD_TIER_NAMES } from '../../../shared/constants';
import { EngagementModal } from '../components/modals';
import { Card, Empty, ListRow, PageHead, Stat, useModal } from '../components/ui';
import { api } from '../lib/api';
import { useWorkspace } from '../lib/workspace';

const TONE: Record<string, string> = { ok: 'var(--ok)', accent: 'var(--accent)', danger: 'var(--danger)' };

export default function Allocation() {
  const { model: m, canEdit, act } = useWorkspace();
  const modal = useModal();
  const [tab, setTab] = useState<'matrix' | 'weights'>('matrix');
  const engs = m.active;
  const people = m.talents.filter((t) => t.engagementCount > 0);
  return (
    <>
      <PageHead title="Resource Allocation" desc="Each person's allocation on each engagement. Defaults come from the engagement's workload tier and the person's role; any cell can be overridden." />
      <div className="tabs">
        <button className={'tab' + (tab === 'matrix' ? ' on' : '')} onClick={() => setTab('matrix')}>Allocation matrix</button>
        <button className={'tab' + (tab === 'weights' ? ' on' : '')} onClick={() => setTab('weights')}>Workload tiers</button>
      </div>
      {tab === 'matrix' ? (
        <Card>
          <div className="small muted" style={{ marginBottom: 8 }}>Only cells for engagements a person is on are editable. ✋ marks an override — click it to return to the tier default. Scroll sideways for more engagements.</div>
          {people.length && engs.length ? (
            <div style={{ overflow: 'auto', maxHeight: '70vh', borderRadius: 10 }}>
              <table className="alloc-table">
                <thead><tr><th>Talent</th>{engs.map((e) => (
                  <th key={e.id} style={{ cursor: 'pointer' }} onClick={() => modal.open(<EngagementModal id={e.id} />)}>
                    <div title={e.name}>{e.name.length > 18 ? e.name.slice(0, 18) + '…' : e.name}</div>
                    <div style={{ fontWeight: 400, color: TONE[WORKLOAD_TIERS[e.workloadTier].tone], fontSize: 9, marginTop: 2 }}>{WORKLOAD_TIERS[e.workloadTier].icon} {e.workloadTier}</div>
                  </th>
                ))}<th>Total</th></tr></thead>
                <tbody>{people.map((t) => (
                  <tr key={t.id}>
                    <td><b>{t.name}</b><div style={{ fontSize: 9.5, color: 'var(--text-faint)' }}>{t.title}</div></td>
                    {engs.map((e) => {
                      if (!m.involves(e, t.id)) return <td key={e.id} style={{ textAlign: 'center', color: 'var(--text-faint)' }}>–</td>;
                      const over = e.allocationOverrides[t.id] !== undefined;
                      return (
                        <td key={e.id} style={{ textAlign: 'center' }}>
                          <AllocCell value={m.allocationPct(t.id, e)} overridden={over} disabled={!canEdit}
                            onSave={(v) => act(() => api.put(`/engagements/${e.id}/allocations/${t.id}`, { pct: v }), `Allocation set to ${v}%`)}
                            onClear={() => act(() => api.put(`/engagements/${e.id}/allocations/${t.id}`, { pct: null }), 'Back to the tier default')} />
                        </td>
                      );
                    })}
                    <td style={{ textAlign: 'center', fontWeight: 700, color: t.computedUtil > 100 ? 'var(--danger)' : undefined }}>{t.computedUtil}%</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : <Empty>No one is staffed on an active engagement.</Empty>}
        </Card>
      ) : (
        <Card>
          <div className="small muted" style={{ marginBottom: 10 }}>Classify each engagement's real intensity. The tier sets the default allocation for everyone on it.</div>
          <div className="stat-strip">{WORKLOAD_TIER_NAMES.map((n) => <Stat key={n} value={`${WORKLOAD_TIERS[n].icon} ${WORKLOAD_TIERS[n].member}%${WORKLOAD_TIERS[n].leader !== WORKLOAD_TIERS[n].member ? ` / ${WORKLOAD_TIERS[n].leader}% lead` : ' flat'}`} label={n} color={TONE[WORKLOAD_TIERS[n].tone]} />)}</div>
          {engs.map((e) => (
            <ListRow key={e.id} title={e.name} desc={`${e.client} · Lead: ${m.name(e.leadId)} · ${m.members(e).length} people`}
              right={<select className="inline-input" disabled={!canEdit} value={e.workloadTier} onChange={(x) => act(() => api.put(`/engagements/${e.id}/workload`, { tier: x.target.value }), 'Workload tier updated')}>
                {WORKLOAD_TIER_NAMES.map((n) => <option key={n} value={n}>{WORKLOAD_TIERS[n].icon} {n}</option>)}
              </select>} />
          ))}
        </Card>
      )}
    </>
  );
}

function AllocCell({ value, overridden, disabled, onSave, onClear }: { value: number; overridden: boolean; disabled: boolean; onSave: (v: number) => void; onClear: () => void }) {
  const [v, setV] = useState(String(value));
  const commit = () => { const n = Math.max(0, Math.min(100, Number(v) || 0)); if (n !== value) onSave(n); else setV(String(value)); };
  return (
    <span style={{ whiteSpace: 'nowrap' }}>
      <input type="number" min={0} max={100} value={v} disabled={disabled} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        style={{ width: 52, background: 'var(--panel-2)', border: `1px solid ${overridden ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 6, color: 'var(--text)', padding: '4px 6px', fontSize: 11.5, textAlign: 'center' }} />%
      {overridden && !disabled && <span title="Overridden — click to use the tier default" style={{ color: 'var(--accent)', fontSize: 10, cursor: 'pointer' }} onClick={onClear}> ✋</span>}
    </span>
  );
}
