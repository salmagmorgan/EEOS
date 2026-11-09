import { useId, useState, type ReactNode } from 'react';
import { LIFECYCLE, MONTHS } from '../../../shared/constants';
import type { DerivedTalent, Model } from '../../../shared/engine';
import type { ScheduledStage } from '../../../shared/schedule';
import type { Engagement } from '../../../shared/types';
import { fmtDate } from './ui';

export const PHASE_COLORS: Record<string, string> = Object.fromEntries(LIFECYCLE.map((s, i) => [s.id, `hsl(${Math.round((i * 360) / LIFECYCLE.length)},68%,60%)`]));

// ---------------- line chart ----------------
export function LineChart({ series, labels, height = 210, max = 100 }: { series: { name: string; color: string; data: (number | null)[] }[]; labels: string[]; height?: number; max?: number }) {
  const uid = useId().replace(/:/g, '');
  const width = 520;
  const pad = { l: 40, r: 30, t: 14, b: 26 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const top = Math.ceil(Math.max(max, ...series.flatMap((s) => s.data.filter((v): v is number => v !== null))) / 25) * 25;
  const x = (i: number) => pad.l + (labels.length > 1 ? (i / (labels.length - 1)) * w : w / 2);
  const y = (v: number) => pad.t + h - (v / top) * h;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(top * f));
  return (
    <div>
      <div style={{ display: 'flex', gap: 16, marginTop: 6, flexWrap: 'wrap' }}>
        {series.map((s) => (
          <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-dim)' }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: s.color, display: 'inline-block' }} />{s.name}
          </div>
        ))}
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img">
        <defs>
          {series.map((s, si) => (
            <linearGradient key={si} id={`${uid}f${si}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity="0.35" /><stop offset="100%" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.l} y1={y(v)} x2={width - pad.r} y2={y(v)} stroke="#1B2138" />
            <text x={pad.l - 8} y={y(v) + 4} fill="#656D8F" fontSize="10" textAnchor="end">{v}%</text>
          </g>
        ))}
        {labels.map((m, i) => <text key={i} x={x(i)} y={height - 6} fill="#656D8F" fontSize="10" textAnchor="middle">{m}</text>)}
        {series.map((s, si) => {
          const pts = s.data.map((v, i) => (v === null ? null : [x(i), y(v)] as const)).filter((p): p is readonly [number, number] => !!p);
          if (!pts.length) return null;
          const line = pts.map((p) => p.join(',')).join(' ');
          const area = `${pts[0][0]},${y(0)} ${line} ${pts[pts.length - 1][0]},${y(0)}`;
          const lastIdx = s.data.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0).pop()!;
          return (
            <g key={si}>
              <polygon points={area} fill={`url(#${uid}f${si})`} />
              <polyline points={line} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
              {s.data.map((v, i) => v === null ? null : <circle key={i} cx={x(i)} cy={y(v)} r="3.2" fill={s.color} stroke="#0A0D18" strokeWidth="1.5"><title>{`${labels[i]}: ${v}%`}</title></circle>)}
              <text x={x(lastIdx) + 6} y={y(s.data[lastIdx]!) - 6} fill={s.color} fontSize="11" fontWeight="700">{s.data[lastIdx]}%</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ---------------- donut ----------------
export function Donut({ buckets, size = 170, onPick }: { buckets: { label: string; count: number; color: string; key: string; members?: string[] }[]; size?: number; onPick?: (key: string, label: string) => void }) {
  const total = buckets.reduce((s, b) => s + b.count, 0);
  const r = size / 2 - 12;
  const c = size / 2;
  let angle = -90;
  const arcs = buckets.filter((b) => b.count).map((b) => {
    const frac = b.count / Math.max(1, total);
    const a2 = angle + frac * 360 - (frac === 1 ? 0.01 : 0);
    const p = (a: number) => [c + r * Math.cos((a * Math.PI) / 180), c + r * Math.sin((a * Math.PI) / 180)];
    const [x1, y1] = p(angle);
    const [x2, y2] = p(a2);
    const d = `M ${x1} ${y1} A ${r} ${r} 0 ${frac > 0.5 ? 1 : 0} 1 ${x2} ${y2}`;
    angle = a2;
    return { d, b };
  });
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} style={{ display: 'block', margin: '0 auto', overflow: 'visible' }}>
        <circle cx={c} cy={c} r={r} fill="none" stroke="#12172B" strokeWidth="23" />
        {arcs.map(({ d, b }) => <path key={b.key} d={d} fill="none" stroke={b.color} strokeWidth="20" strokeLinecap="butt"><title>{`${b.label}: ${b.count}`}</title></path>)}
        <text x={c} y={c - 2} textAnchor="middle" fill="#E9ECF7" fontSize="26" fontWeight="700" fontFamily="Sora">{total}</text>
        <text x={c} y={c + 16} textAnchor="middle" fill="#656D8F" fontSize="9" letterSpacing="1">TOTAL</text>
      </svg>
      <div style={{ flex: 1, minWidth: 150 }}>
        {buckets.map((b) => (
          <div key={b.key} className={'legend-item' + (onPick ? ' hoverable' : '')} onClick={() => onPick?.(b.key, b.label)}>
            <span className="legend-dot" style={{ background: b.color }} />{b.label}
            <span className="lval">{b.count}</span><span className="lsub">({Math.round((b.count / Math.max(1, total)) * 100)}%)</span>
            {b.members && (
              <div className="legend-hover-panel">
                <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-dim)', marginBottom: 6 }}>{b.label} ({b.members.length})</div>
                {b.members.length ? b.members.map((n) => <div key={n} style={{ fontSize: 11, color: 'var(--text-dim)', padding: '4px 0', borderBottom: '1px solid var(--border-soft)' }}>{n}</div>) : <div className="muted small">No one currently.</div>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- horizontal bars ----------------
export function Bars({ rows, labelWidth = 110, onPick, suffix = '' }: { rows: { label: string; value: number; color?: string; key?: string }[]; labelWidth?: number; onPick?: (key: string) => void; suffix?: string }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  return (
    <>
      {rows.map((r, i) => (
        <div key={r.key ?? r.label + i} className="bar-row" style={onPick ? { cursor: 'pointer' } : undefined} onClick={() => onPick?.(r.key ?? r.label)}>
          <div className="blabel" style={{ width: labelWidth, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.label}>{r.label}</div>
          <div className="bar-track"><div className="bar-fill" style={{ width: `${(Math.abs(r.value) / max) * 100}%`, ...(r.color ? { background: r.color } : {}) }} /></div>
          <div className="bar-val" style={{ width: 'auto', minWidth: 26 }}>{r.value}{suffix}</div>
        </div>
      ))}
    </>
  );
}

// ---------------- utilization heatmap ----------------
export function heatColor(v: number | null) {
  if (v === null) return { bg: '#171C30', fg: '#4A5170' };
  if (v > 100) return { bg: '#6E1719', fg: '#F5949E' };
  if (v >= 75) return { bg: '#4A49A7', fg: '#DAD5F2' };
  if (v >= 55) return { bg: '#2B2D6E', fg: '#ADA9D9' };
  return { bg: '#1B1D46', fg: '#8B85BE' };
}

export function Heatmap({ model, talents, onPick }: { model: Model; talents: DerivedTalent[]; onPick: (id: string) => void }) {
  const year = model.now.getUTCFullYear();
  const cur = model.now.getUTCMonth();
  return (
    <table className="data">
      <thead><tr><th>Talent</th>{MONTHS.map((m, i) => <th key={m} style={{ textAlign: 'center' }}>{m}{i === cur && <span style={{ color: 'var(--accent)' }}> ●</span>}</th>)}</tr></thead>
      <tbody>
        {talents.map((t) => (
          <tr key={t.id} onClick={() => onPick(t.id)}>
            <td><div style={{ fontWeight: 600, color: 'var(--accent)' }}>{t.name}</div><div style={{ fontSize: 10.5, color: 'var(--text-faint)' }}>{t.title}</div></td>
            {MONTHS.map((_, m) => {
              const { value, kind } = model.talentMonthUtil(t, year, m);
              const c = heatColor(value);
              return <td key={m} className="heat-cell" title={kind} style={{ background: c.bg, color: c.fg, border: kind !== 'past' ? '1px dashed rgba(255,255,255,0.25)' : undefined }}>{value === null ? '–' : value + '%'}</td>;
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------- critical path schedule bar ----------------
export function CpsBar({ model, e }: { model: Model; e: Pick<Engagement, 'start' | 'end' | 'scope' | 'stage' | 'customCps'> }) {
  const [picked, setPicked] = useState<ScheduledStage | null>(null);
  const info = model.schedule(e as Engagement);
  if (!info) return <div className="empty-state" style={{ padding: 14 }}>Add a start and end date to generate the Critical Path Schedule.</div>;
  const total = Math.max(1, info.end.getTime() - info.start.getTime());
  const idx = info.stages.findIndex((s) => s.id === e.stage);
  const meta = info.stages[info.stages.length - 1];
  const status = info.isComplete
    ? <b style={{ color: 'var(--ok)' }}>✅ Complete — closed at {meta.label}</b>
    : <>{info.closingSoon && <b style={{ color: 'var(--warn)' }}>⚠ Closing soon · </b>}{info.daysLeft >= 0 ? `${info.daysLeft} days left` : `${-info.daysLeft} days overdue`}</>;
  return (
    <div style={{ marginTop: 4 }}>
      {info.isCustomSchedule && <div style={{ fontSize: 10, color: 'var(--ok)', marginBottom: 5 }}>📤 Using the uploaded weekly plan, not the auto-projected schedule.</div>}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-faint)', marginBottom: 5, gap: 8 }}>
        <span>{fmtDate(info.start)}</span><span>{status}</span><span>{fmtDate(info.end)}</span>
      </div>
      <div style={{ display: 'flex', height: 16, borderRadius: 6, overflow: 'hidden', position: 'relative', background: '#1B2138' }}>
        {info.cps.map((s, i) => {
          const sIdx = info.stages.findIndex((x) => x.id === s.id);
          const state = sIdx < idx ? 'done' : s.id === e.stage ? 'current' : 'upcoming';
          const left = ((s.start.getTime() - info.start.getTime()) / total) * 100;
          const w = Math.max(0.5, ((s.end.getTime() - s.start.getTime()) / total) * 100);
          return (
            <div key={i} title={s.label} onClick={() => setPicked(picked?.id === s.id ? null : s)}
              style={{ position: 'absolute', left: left + '%', width: w + '%', top: 0, bottom: 0, cursor: 'pointer', borderLeft: i ? '1px solid #0A0D18' : undefined,
                background: state === 'done' ? 'var(--accent-dim)' : state === 'current' ? (info.isComplete ? 'var(--ok)' : 'var(--accent)') : '#262D4A',
                outline: state === 'current' ? '1.5px solid #fff' : undefined, outlineOffset: -2 }} />
          );
        })}
        <div title="Today" style={{ position: 'absolute', left: `${info.pctElapsed}%`, top: 0, bottom: 0, width: 2, background: '#fff', boxShadow: '0 0 6px #fff' }} />
      </div>
      <div style={{ fontSize: 9.5, color: 'var(--text-faint)', marginTop: 4 }}>
        Current stage: <b style={{ color: 'var(--text-dim)' }}>{LIFECYCLE.find((s) => s.id === e.stage)?.label ?? e.stage}</b> — <i>{LIFECYCLE.find((s) => s.id === e.stage)?.details}</i>
      </div>
      {picked && (
        <div className="box" style={{ marginTop: 8, fontSize: 11.5 }}>
          <b>{picked.label}</b> · {fmtDate(picked.start, { day: '2-digit', month: 'short' })} – {fmtDate(picked.end, { day: '2-digit', month: 'short' })}{picked.owner ? ` · Owner: ${picked.owner}` : ''}
          <div className="muted" style={{ marginTop: 3 }}>{LIFECYCLE.find((s) => s.id === picked.id)?.details}</div>
        </div>
      )}
      {info.cps.some((s) => s.owner) && (
        <div className="pill-row">{info.cps.filter((s) => s.owner).map((s) => <span key={s.id} className="mini-pill">{s.label}: {s.owner}</span>)}</div>
      )}
    </div>
  );
}

// ---------------- lifecycle stage strip ----------------
export function StageStrip({ counts, onPick }: { counts: Record<string, number>; onPick: (id: string) => void }) {
  return (
    <div className="lifecycle-row">
      {LIFECYCLE.map((s, i) => (
        <FragmentWithArrow key={s.id} last={i === LIFECYCLE.length - 1}>
          <div className="lc-stage" onClick={() => onPick(s.id)}>
            <div className="lc-icon" style={{ background: s.tone === 'danger' ? 'var(--danger-dim)' : 'var(--accent-glow)', color: s.tone === 'danger' ? 'var(--danger)' : 'var(--accent)' }}>{s.icon}</div>
            <div className="lc-label">{s.label}</div>
            <div className="lc-count">{counts[s.id] ?? 0}</div>
          </div>
        </FragmentWithArrow>
      ))}
    </div>
  );
}
function FragmentWithArrow({ children, last }: { children: ReactNode; last: boolean }) {
  return <>{children}{!last && <div className="lc-arrow">→</div>}</>;
}
