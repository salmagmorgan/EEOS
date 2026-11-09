import { useEffect, useState } from 'react';
import { LIFECYCLE } from '../../../shared/constants';
import { parseDay } from '../../../shared/schedule';
import { PHASE_COLORS, StageStrip } from '../components/charts';
import { EngagementListModal, EngagementModal } from '../components/modals';
import { Card, Empty, PageHead, fmtDate, useModal } from '../components/ui';
import { useModel } from '../lib/workspace';

const WEEK = 7 * 86_400_000;

export default function Lifecycle() {
  const m = useModel();
  const modal = useModal();
  const [who, setWho] = useState('');
  const [offset, setOffset] = useState(0);
  const [only, setOnly] = useState<string | null>(null);
  const [clock, setClock] = useState(new Date());
  useEffect(() => { const id = setInterval(() => setClock(new Date()), 30_000); return () => clearInterval(id); }, []);

  const y = m.now.getUTCFullYear();
  const mo = m.now.getUTCMonth();
  const minT = Date.UTC(y, mo - 1 + offset, 1);
  const maxT = Date.UTC(y, mo + 11 + offset, 1) - 1;
  let list = m.active.filter((e) => (!who || m.involves(e, who)) && parseDay(e.end).getTime() >= minT && parseDay(e.start).getTime() <= maxT);
  if (only) list = list.filter((e) => e.id === only);
  const scoped = who ? m.active.filter((e) => m.involves(e, who)) : m.active;
  const counts = Object.fromEntries(LIFECYCLE.map((s) => [s.id, scoped.filter((e) => e.stage === s.id).length]));
  const openPhase = (id: string) => modal.open(<EngagementListModal title={`📍 ${LIFECYCLE.find((s) => s.id === id)?.label}`} blurb={LIFECYCLE.find((s) => s.id === id)?.details} ids={scoped.filter((e) => e.stage === id).map((e) => e.id)} />);

  const rowH = 30, padTop = 36, padLeft = 200, padRight = 16;
  const span = maxT - minT;
  const chartW = Math.max(680, Math.ceil(span / WEEK) * 40);
  const width = padLeft + chartW + padRight;
  const height = padTop + list.length * rowH + 8;
  const xPos = (t: number) => padLeft + Math.min(1, Math.max(0, (t - minT) / span)) * chartW;
  const ticks: number[] = [];
  for (let t = minT; t <= maxT; t += WEEK) ticks.push(t);
  const now = m.now.getTime();

  return (
    <>
      <PageHead title="Engagement Lifecycle" desc="Every active engagement, week by week, across a rolling twelve-month window — which phase it is in and where it sits on the calendar." />
      <Card title="Engagement timeline (by phase)" sub={
        <select className="inline-input" value={who} onChange={(e) => { setWho(e.target.value); setOnly(null); }}>
          <option value="">All team members</option>{m.talents.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>} style={{ marginBottom: 16 }}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 10.5, color: 'var(--accent)', fontWeight: 600 }}>🟢 Live — {clock.toLocaleString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
          <div className="row">
            <button className="btn btn-sm" onClick={() => setOffset(offset - 1)}>← Earlier</button>
            <span className="small" style={{ fontWeight: 600, color: 'var(--text-dim)' }}>{fmtDate(new Date(minT), { month: 'short', year: 'numeric' })} – {fmtDate(new Date(maxT), { month: 'short', year: 'numeric' })}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setOffset(0)}>Today</button>
            <button className="btn btn-sm" onClick={() => setOffset(offset + 1)}>Later →</button>
          </div>
        </div>
        {only && <div className="row" style={{ marginBottom: 8 }}><span className="small" style={{ color: 'var(--accent)', fontWeight: 600 }}>🔎 Showing only {m.engagement(only)?.name}</span><button className="btn btn-ghost btn-sm" onClick={() => setOnly(null)}>Show all</button></div>}
        <div className="small muted" style={{ marginBottom: 6 }}>Click a name to isolate it, a phase bar to open the engagement.</div>
        {list.length ? (
          <div style={{ overflowX: 'auto' }}>
            <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} style={{ display: 'block' }}>
              {list.map((e, i) => {
                const yy = padTop + i * rowH;
                return (
                  <g key={e.id}>
                    <rect x={padLeft} y={yy} width={chartW} height={rowH} fill={i % 2 ? 'transparent' : 'rgba(255,255,255,0.015)'} />
                    <text x={padLeft - 10} y={yy + rowH / 2 - 2} fill="#DDE1F5" fontSize="10.5" fontWeight="700" textAnchor="end" style={{ cursor: 'pointer' }} onClick={() => setOnly(e.id)}>{e.name.length > 26 ? e.name.slice(0, 26) + '…' : e.name}</text>
                    <text x={padLeft - 10} y={yy + rowH / 2 + 11} fill="#8B92AC" fontSize="8.5" textAnchor="end">{m.name(e.leadId)}</text>
                  </g>
                );
              })}
              {ticks.map((t, i) => {
                const d = new Date(t);
                const newMonth = i === 0 || new Date(ticks[i - 1]).getUTCMonth() !== d.getUTCMonth();
                return (
                  <g key={t}>
                    <line x1={xPos(t)} y1={padTop} x2={xPos(t)} y2={height - 8} stroke={newMonth ? '#2E2A5C' : '#161B2E'} />
                    {newMonth && <text x={xPos(t) + 3} y={14} fill="#C9C5F0" fontSize="9.5" fontWeight="700">{fmtDate(d, { month: 'short', year: '2-digit' })}</text>}
                    <text x={xPos(t) + 3} y={26} fill="#5A6180" fontSize="8.5">W{Math.ceil(d.getUTCDate() / 7)}</text>
                  </g>
                );
              })}
              {now >= minT && now <= maxT && <line x1={xPos(now)} y1={padTop} x2={xPos(now)} y2={height - 8} stroke="#fff" strokeWidth="1.3" strokeDasharray="3,3" opacity="0.65" />}
              {list.map((e, i) => m.schedule(e)!.cps.map((s) => {
                if (s.end.getTime() < minT || s.start.getTime() > maxT) return null;
                const x1 = xPos(s.start.getTime());
                const current = s.id === e.stage;
                return (
                  <rect key={e.id + s.id} x={x1} y={padTop + i * rowH + rowH / 2 - 9} width={Math.max(2, xPos(s.end.getTime()) - x1)} height={18} rx={4} fill={PHASE_COLORS[s.id]}
                    opacity={current ? 1 : 0.55} stroke={current ? '#fff' : undefined} strokeWidth={current ? 1.5 : 0} style={{ cursor: 'pointer' }} onClick={() => modal.open(<EngagementModal id={e.id} />)}>
                    <title>{`${s.label} — ${e.name}\n${fmtDate(s.start)} – ${fmtDate(s.end)}${s.owner ? ' · ' + s.owner : ''}`}</title>
                  </rect>
                );
              }))}
            </svg>
          </div>
        ) : <Empty>No active engagements fall in this window. Use ← Earlier / Later →.</Empty>}
        <div className="row" style={{ marginTop: 12, gap: 6 }}>
          {LIFECYCLE.map((s) => (
            <button key={s.id} className="tab" style={{ fontSize: 10, padding: '3px 9px', borderRadius: 20 }} onClick={() => openPhase(s.id)}>
              <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: PHASE_COLORS[s.id], marginRight: 5 }} />{s.label} <span className="muted">({counts[s.id]})</span>
            </button>
          ))}
        </div>
      </Card>
      <Card title="Projects per phase"><div style={{ overflowX: 'auto' }}><StageStrip counts={counts} onPick={openPhase} /></div></Card>
    </>
  );
}
