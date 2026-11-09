import { useMemo, useState } from 'react';
import type { DerivedTalent } from '../../../shared/engine';
import { TalentModal } from '../components/modals';
import { Card, Empty, ListRow, PageHead, Tag, useModal } from '../components/ui';
import { useModel } from '../lib/workspace';

export default function Suggestions() {
  const m = useModel();
  const modal = useModal();
  const [leader, setLeader] = useState('');
  const [size, setSize] = useState(2);
  const [seed, setSeed] = useState(1);
  const eligible = m.talents.filter((t) => t.department !== 'Operations' && t.utilStatus !== 'Overutilized').sort((a, b) => a.name.localeCompare(b.name));
  const options = useMemo(() => {
    const seen = new Set<string>();
    const out: DerivedTalent[][] = [];
    for (let i = 0; i < 15 && out.length < 3; i++) {
      const team = m.suggestFreshTeam(leader || null, size + 1);
      const key = team.map((t) => t.id).sort().join(',');
      if (team.length >= 2 && !seen.has(key)) { seen.add(key); out.push(team); }
    }
    return out;
  }, [m, leader, size, seed]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = m.openCapacity();
  return (
    <>
      <PageHead title="Engagement Suggestions" />
      <Card title="🎯 People with open capacity right now" style={{ marginBottom: 16 }}>
        <div className="small muted" style={{ marginBottom: 8 }}>Ranked by open project slots (capacity minus current engagements). Operations and anyone over capacity are excluded.</div>
        {open.length ? open.map((t) => <ListRow key={t.id} icon={t.initials} title={t.name} desc={`${t.title} · ${t.department} · ${t.util}% utilized`} right={<b style={{ color: 'var(--ok)', fontSize: 11.5 }}>{t.openSlots} open slot{t.openSlots !== 1 && 's'}</b>} onClick={() => modal.open(<TalentModal id={t.id} />)} />)
          : <Empty>No one has open capacity right now.</Empty>}
      </Card>
      <div className="section-desc">Pick a leader and team size to see fresh team structures — built from who has worked together least across the firm's whole history.</div>
      <div className="filters-bar">
        <select value={leader} onChange={(e) => setLeader(e.target.value)}><option value="">🎲 Suggest a leader for me</option>{eligible.map((t) => <option key={t.id} value={t.id}>{t.name} — {t.title}</option>)}</select>
        <select value={size} onChange={(e) => setSize(Number(e.target.value))}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} member{n > 1 && 's'}</option>)}</select>
        <button className="btn btn-primary btn-sm" onClick={() => setSeed(seed + 1)}>🔁 Build new options</button>
      </div>
      {options.length ? options.map((team, idx) => {
        const { pairRows, reasons } = m.teamRationale(team);
        return (
          <Card key={team.map((t) => t.id).join()} title={`Option ${idx + 1}`} style={{ marginBottom: 16 }}>
            <div className="row" style={{ alignItems: 'stretch', marginBottom: 12 }}>
              {team.map((t, i) => (
                <div key={t.id} className="card" style={{ flex: 1, minWidth: 180, cursor: 'pointer', ...(i === 0 ? { background: 'var(--accent-glow)', borderColor: 'var(--accent-dim)' } : {}) }} onClick={() => modal.open(<TalentModal id={t.id} />)}>
                  <div className="small muted" style={{ textTransform: 'uppercase', marginBottom: 6 }}>{i === 0 ? (leader ? 'Your leader' : 'Suggested leader') : 'Member'}</div>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{t.name}</div>
                  <div className="small muted">{t.title} · {t.util}% utilized</div>
                </div>
              ))}
            </div>
            <div className="small muted" style={{ marginBottom: 6 }}>ROTATION CRITERIA — {reasons.filter((r) => r.met).length} of {reasons.length} met</div>
            {reasons.map((r) => <div key={r.text} style={{ fontSize: 12, color: r.met ? 'var(--text-dim)' : 'var(--text-faint)', padding: '5px 0', borderBottom: '1px solid var(--border-soft)' }}>{r.met ? '✅' : '—'} {r.text}</div>)}
            <div className="small muted" style={{ margin: '10px 0 6px' }}>PAIRING DETAIL</div>
            {pairRows.map((p) => <div key={p.a + p.b} className="row" style={{ justifyContent: 'space-between', padding: '4px', fontSize: 11.5 }}><span style={{ color: 'var(--text-dim)' }}>{p.a} + {p.b}</span><Tag className={p.count === 0 ? 'tag-ok' : p.count >= 3 ? 'tag-danger' : 'tag-warn'}>{p.count === 0 ? 'Never together' : `${p.count}x before`}</Tag></div>)}
          </Card>
        );
      }) : <Empty>Not enough eligible people with capacity to suggest a team.</Empty>}
    </>
  );
}
