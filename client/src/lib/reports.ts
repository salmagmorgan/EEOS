/* Printable, self-contained HTML reports generated from the live model. */
import { fmtMoney, type Model } from '../../../shared/engine';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const today = () => new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
const FONTS = '<link href="https://fonts.googleapis.com/css2?family=Sora:wght@700;800&family=Inter:wght@400;600;700&display=swap" rel="stylesheet">';
const UTIL = [
  { key: 'Underutilized', color: '#8F7FC4' }, { key: 'Optimal', color: '#4A49A7' }, { key: 'At Capacity', color: '#D48806' },
  { key: 'Overutilized', color: '#ED2429' }, { key: 'Not Allocated', color: '#B7BAC4' },
];
const HEALTH_COLORS: Record<string, string> = { 'Just Opened': '#4A49A7', Midway: '#6C68D6', 'About to Close': '#F47381', Delayed: '#ED2429', Complete: '#4FC98A' };

function donut(counts: { color: string; count: number }[], size: number, thick: number): string {
  const total = counts.reduce((s, c) => s + c.count, 0) || 1;
  const r = size / 2 - thick / 2 - 2, c = size / 2;
  let a = -90;
  const arcs = counts.filter((x) => x.count).map((x) => {
    const frac = x.count / total, a2 = a + frac * 360 - (frac === 1 ? 0.01 : 0);
    const p = (d: number) => `${c + r * Math.cos((d * Math.PI) / 180)} ${c + r * Math.sin((d * Math.PI) / 180)}`;
    const path = `<path d="M ${p(a)} A ${r} ${r} 0 ${frac > 0.5 ? 1 : 0} 1 ${p(a2)}" fill="none" stroke="${x.color}" stroke-width="${thick}"/>`;
    a = a2;
    return path;
  }).join('');
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${arcs}<text x="${c}" y="${c + 6}" text-anchor="middle" font-size="${size / 6}" font-weight="700" fill="#111">${total}</text></svg>`;
}

function line(values: (number | null)[], labels: string[]): string {
  const w = 500, h = 120, l = 32, b = 18, t = 8;
  const x = (i: number) => l + (i / (labels.length - 1)) * (w - l - 10), y = (v: number) => t + (h - t - b) - (Math.min(v, 120) / 120) * (h - t - b);
  const pts = values.map((v, i) => (v === null ? null : `${x(i)},${y(v)}`)).filter(Boolean).join(' ');
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}">${[0, 50, 100].map((v) => `<line x1="${l}" y1="${y(v)}" x2="${w - 10}" y2="${y(v)}" stroke="#E4E4E8"/><text x="${l - 6}" y="${y(v) + 3}" font-size="8" fill="#888" text-anchor="end">${v}%</text>`).join('')}
    <polyline points="${pts}" fill="none" stroke="#4A49A7" stroke-width="2"/>${labels.map((m, i) => `<text x="${x(i)}" y="${h - 4}" font-size="7.5" fill="#888" text-anchor="middle">${m}</text>`).join('')}</svg>`;
}

function kpiBoxes(items: { label: string; value: string | number }[]): string {
  return `<div style="display:flex;gap:10px;margin-bottom:18px;">${items.map((k) => `<div style="flex:1;border:1px solid #E4E4E8;border-radius:8px;padding:12px;text-align:center;"><div style="font-family:Sora,sans-serif;font-size:22px;font-weight:800;">${esc(k.value)}</div><div style="font-size:8.5px;color:#666;text-transform:uppercase;letter-spacing:.4px;margin-top:3px;">${esc(k.label)}</div></div>`).join('')}</div>`;
}

export function snapshotHtml(m: Model, author: string): string {
  const t = m.talents;
  const year = m.now.getUTCFullYear();
  const trend = m.monthlyTrend(year);
  const health: Record<string, number> = {};
  m.active.forEach((e) => { const h = m.health(e); health[h] = (health[h] ?? 0) + 1; });
  const buckets = UTIL.map((u) => ({ ...u, count: t.filter((x) => x.utilStatus === u.key).length }));
  const body = `
  <div style="display:flex;justify-content:space-between;border-bottom:2px solid #4A49A7;padding-bottom:10px;margin-bottom:16px;">
    <div><div style="font-family:Sora,sans-serif;font-weight:800;font-size:20px;">TBC — Engagement Excellence Snapshot</div><div style="font-size:10.5px;color:#666;">The Board Consulting · Insights . Strategy . Impact</div></div>
    <div style="text-align:right;font-size:10px;color:#666;">Generated ${today()}<br>by ${esc(author)}</div>
  </div>
  ${kpiBoxes([{ label: 'Active engagements', value: m.active.length }, { label: 'Firm utilization', value: m.firmUtilization + '%' }, { label: 'Over capacity', value: t.filter((x) => x.util > 100).length }, { label: 'Talents', value: t.length }, { label: 'Active clients', value: m.clients().filter((c) => c.active).length }])}
  <div style="display:flex;gap:20px;margin-bottom:18px;">
    <div style="flex:1.4;"><h4>Utilization trend — ${year}</h4>${line(trend.map((x) => x.value), trend.map((x) => x.label))}</div>
    <div style="flex:1;display:flex;gap:12px;align-items:center;"><div><h4>Capacity split</h4>${donut(buckets, 104, 16)}</div>
      <div style="font-size:9px;">${buckets.map((b) => `<div style="margin-bottom:3px;"><span style="display:inline-block;width:7px;height:7px;background:${b.color};margin-right:5px;"></span>${b.key}: <b>${b.count}</b></div>`).join('')}</div></div>
  </div>
  <div style="display:flex;gap:20px;">
    <div style="flex:1;"><h4>Top risks & alerts</h4>${m.alerts().slice(0, 5).map((a) => `<div style="font-size:9.5px;margin-bottom:6px;padding-left:10px;border-left:2px solid ${a.tone === 'danger' ? '#ED2429' : '#4A49A7'};"><b>${esc(a.title)}</b><br><span style="color:#777;">${esc(a.desc)}</span></div>`).join('') || '<div style="font-size:10px;">No active alerts.</div>'}</div>
    <div style="flex:1;"><h4>Engagement health</h4>${Object.entries(health).map(([h, n]) => `<div style="font-size:9.5px;margin-bottom:5px;"><span style="display:inline-block;width:8px;height:8px;background:${HEALTH_COLORS[h] ?? '#999'};margin-right:6px;"></span>${h}: <b>${n}</b></div>`).join('')}
      <h4 style="margin-top:14px;">Hiring gaps</h4>${m.hiringNeeds().map((h) => `<div style="font-size:9.5px;margin-bottom:4px;">${esc(h.title)} (${esc(h.department)}) — ${h.avgUtil}% · ~${h.fteGap} FTE</div>`).join('') || '<div style="font-size:9.5px;">None</div>'}</div>
  </div>
  <div style="margin-top:24px;padding-top:8px;border-top:1px solid #E4E4E8;font-size:8px;color:#999;text-align:center;">Confidential — TBC internal · Generated live from EEOS</div>`;
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>TBC Engagement Excellence Snapshot</title>${FONTS}
  <style>body{font-family:Inter,sans-serif;color:#111;margin:0 auto;padding:24px;max-width:800px;}h4{font-size:10.5px;text-transform:uppercase;letter-spacing:.4px;margin:0 0 8px;}
  .bar{position:sticky;top:0;background:#fff;padding:10px 0;text-align:right;border-bottom:1px solid #eee;margin-bottom:10px;}.bar button{background:#4A49A7;color:#fff;border:0;border-radius:8px;padding:9px 16px;font-weight:600;cursor:pointer;}
  @media print{.bar{display:none}@page{size:A4;margin:14mm}body{padding:0}}</style></head>
  <body><div class="bar"><button onclick="window.print()">🖨 Print / Save as PDF</button></div>${body}</body></html>`;
}

export function boardDeckHtml(m: Model, author: string): string {
  const t = m.talents;
  const all = m.engagements;
  const slide = (n: string, inner: string, dark = false) => `<section class="slide${dark ? ' dark' : ''}">${inner}<div class="foot"><span>The Board Consulting — Confidential</span><span>${n}</span></div></section>`;
  const h2 = (s: string, sub = '') => `<h2>${s}</h2>${sub ? `<div class="sub">${sub}</div>` : ''}`;
  const health: Record<string, number> = {};
  m.active.forEach((e) => { const h = m.health(e); health[h] = (health[h] ?? 0) + 1; });
  const sectors = m.sectorDistribution().slice(0, 6);
  const maxS = Math.max(1, ...sectors.map((s) => s.engagements.length));
  const fin = m.active.map((e) => ({ e, f: m.financials(e) })).filter((x) => x.f) as { e: (typeof all)[number]; f: NonNullable<ReturnType<Model['financials']>> }[];
  const rev = fin.reduce((s, x) => s + x.f.price, 0), cost = fin.reduce((s, x) => s + x.f.cost, 0);
  const buckets = UTIL.map((u) => ({ ...u, count: t.filter((x) => x.utilStatus === u.key).length }));
  const rot = m.rotationRisk();
  const row = (l: string, r: string, color = '#111') => `<div class="row"><span>${esc(l)}</span><b style="color:${color}">${esc(r)}</b></div>`;
  const slides = [
    slide('01', `<div class="title"><div class="eyebrow">The Board Consulting</div><h1>Engagement Excellence<br>Board Summary</h1><div class="meta">${today()} · Prepared by ${esc(author)}</div></div>`, true),
    slide('02', h2('Executive summary', 'The engagement portfolio right now') + kpiBoxes([
      { label: 'Active engagements', value: m.active.length }, { label: 'Firm utilization', value: m.firmUtilization + '%' }, { label: 'Over capacity', value: t.filter((x) => x.util > 100).length },
      { label: 'Active clients', value: m.clients().filter((c) => c.active).length }, { label: 'Sectors served (all time)', value: m.sectorDistribution().length },
    ]) + `<div class="cols"><div><h4>Top alerts</h4>${m.alerts().slice(0, 4).map((a) => `<p class="alert">${esc(a.title)}</p>`).join('') || '<p>None</p>'}</div><div><h4>Hiring gaps</h4>${m.hiringNeeds().map((h) => `<p>${esc(h.title)} · ${esc(h.department)} — ~${h.fteGap} FTE (${h.urgency})</p>`).join('') || '<p>None right now</p>'}</div></div>`),
    slide('03', h2('Engagement portfolio') + `<div class="cols"><div><h4>By health</h4>${Object.entries(health).map(([h, n]) => `<div class="row"><span><i style="background:${HEALTH_COLORS[h] ?? '#999'}"></i>${h}</span><b>${n}</b></div>`).join('')}</div>
      <div><h4>Top sectors, all time</h4>${sectors.map((s) => `<div class="bar"><div class="row"><span>${esc(s.sector)}</span><b>${s.engagements.length}</b></div><div class="track"><div style="width:${(s.engagements.length / maxS) * 100}%"></div></div></div>`).join('')}</div></div>`),
    slide('04', h2('Financial summary', `Across ${fin.length} active engagement(s) with recorded financials`) + kpiBoxes([
      { label: 'Selling price', value: fmtMoney(rev) }, { label: 'Cost', value: fmtMoney(cost) }, { label: 'Gross profit', value: fmtMoney(rev - cost) }, { label: 'Margin', value: (rev ? Math.round(((rev - cost) / rev) * 100) : 0) + '%' },
    ]) + `<h4>By engagement</h4>${fin.slice(0, 8).map((x) => row(x.e.name, x.f.profitabilityPct + '%', x.f.profitabilityPct >= 0 ? '#1B8A5A' : '#C0392B')).join('') || '<p>No financials recorded yet.</p>'}`),
    slide('05', h2('Talent utilization') + `<div class="cols" style="align-items:center;"><div style="flex:0 0 220px">${donut(buckets, 180, 22)}</div><div>${buckets.map((b) => `<div class="row"><span><i style="background:${b.color}"></i>${b.key}</span><b>${b.count}</b></div>`).join('')}</div></div>
      <h4 style="margin-top:20px;">Most loaded</h4>${[...t].sort((a, b) => b.util - a.util).slice(0, 5).map((x) => row(`${x.name} — ${x.title}`, x.util + '%', x.util > 100 ? '#C0392B' : '#111')).join('')}`),
    slide('06', h2('Team health & rotation', 'Who keeps working together, and who carries the most concurrent leadership') + `<div class="cols"><div><h4>Repeat pairings (2+ active engagements)</h4>${rot.repeatPairs.slice(0, 6).map((p) => row(`${p.aName} + ${p.bName}`, p.count + 'x')).join('') || '<p>None — good rotation.</p>'}</div>
      <div><h4>Leaders on 3+ engagements</h4>${rot.concentratedLeaders.map((l) => row(l.name, String(l.count))).join('') || '<p>None.</p>'}</div></div>`),
    slide('07', h2('Top clients', 'By active engagements') + m.clients().filter((c) => c.active).sort((a, b) => b.active - a.active).slice(0, 8).map((c) => row(`${c.name} · ${c.industry} · owner ${c.owner}`, `${c.active} active · ${c.historical} past`)).join('')),
  ];
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>TBC Board Summary Deck</title>${FONTS}<style>
  body{margin:0;background:#E9E9EF;font-family:Inter,sans-serif;}
  .slide{width:min(1100px,96vw);aspect-ratio:16/9;margin:24px auto;background:#fff;color:#111;box-sizing:border-box;padding:44px 56px;display:flex;flex-direction:column;box-shadow:0 10px 30px rgba(0,0,0,.12);border-radius:6px;overflow:hidden;}
  .slide.dark{background:linear-gradient(135deg,#171E36,#0A0D18);color:#fff;}
  h1{font-family:Sora,sans-serif;font-size:44px;line-height:1.15;margin:0;} h2{font-family:Sora,sans-serif;font-size:26px;color:#4A49A7;margin:0 0 6px;} .sub{font-size:11px;color:#666;margin-bottom:22px;}
  h4{font-size:11px;text-transform:uppercase;letter-spacing:.4px;margin:0 0 10px;} p{font-size:11.5px;margin:0 0 7px;color:#333;} .alert{border-left:2px solid #ED2429;padding-left:8px;}
  .title{flex:1;display:flex;flex-direction:column;justify-content:center;} .eyebrow{font-family:Sora,sans-serif;font-weight:800;font-size:14px;letter-spacing:3px;color:#B1A7DA;text-transform:uppercase;margin-bottom:18px;} .meta{font-size:14px;opacity:.6;margin-top:20px;}
  .cols{display:flex;gap:36px;} .cols>div{flex:1;} .row{display:flex;justify-content:space-between;gap:12px;padding:6px 0;border-bottom:1px solid #EFEFF3;font-size:11.5px;}
  .row i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:8px;} .bar{margin-bottom:6px;} .track{background:#EFEFF3;border-radius:6px;height:6px;} .track div{background:#6C68D6;height:6px;border-radius:6px;}
  .foot{margin-top:auto;padding-top:16px;font-size:9px;opacity:.5;display:flex;justify-content:space-between;}
  @media print{body{background:#fff}.slide{margin:0;box-shadow:none;border-radius:0;width:100%;page-break-after:always}@page{size:landscape;margin:0}}
  </style></head><body>${slides.join('')}</body></html>`;
}
