import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useWorkspace } from '../lib/workspace';
import { AddTalentModal, ClientModal, EngagementModal, TalentModal } from './modals';
import { Avatar, useModal } from './ui';

export const NAV: { group?: string; items: { to: string; label: string; title: string; primary?: boolean }[] }[] = [
  { items: [
    { to: '/', label: '▦ Executive Dashboard', title: 'Command Center', primary: true },
    { to: '/copilot', label: '✨ AI Copilot', title: 'AI Copilot', primary: true },
  ] },
  { group: 'Engagements', items: [
    { to: '/engagements/new', label: '➕ New Engagement', title: 'New Engagement' },
    { to: '/engagements/lifecycle', label: 'Engagement Lifecycle', title: 'Lifecycle' },
    { to: '/engagements/status', label: 'Engagement Status', title: 'Status Overview' },
    { to: '/engagements/profitability', label: 'Engagement Profitability', title: 'Profitability' },
    { to: '/engagements/trajectory', label: 'Engagement Trajectory', title: 'Engagement Trajectory' },
    { to: '/engagements/suggestions', label: 'Engagement Suggestions', title: 'Team Suggestions' },
  ] },
  { group: 'Talents', items: [
    { to: '/talents', label: 'Talent Directory', title: 'Directory' },
    { to: '/talents/trajectory', label: 'Talent Trajectory', title: 'Talent Trajectory' },
  ] },
  { group: 'Traffic Control', items: [
    { to: '/traffic/capacity', label: 'Capacity Intelligence', title: 'Capacity Intelligence' },
    { to: '/traffic/planner', label: 'Capacity Planner', title: 'Capacity Planner' },
    { to: '/traffic/monitor', label: 'Utilization & Burnout', title: 'Utilization Monitor & Burnout Alerts' },
    { to: '/traffic/allocation', label: 'Resource Allocation', title: 'Resource Allocation' },
  ] },
  { group: 'Hiring & Forecast', items: [
    { to: '/hiring/forecast', label: 'Hiring Forecast', title: 'Hiring Forecast' },
    { to: '/hiring/roles', label: 'Role Planning', title: 'Role Planning' },
  ] },
  { group: 'Clients', items: [{ to: '/clients', label: 'Client Portfolio', title: 'Portfolio & Relationships' }] },
  { group: 'Insights & Reports', items: [
    { to: '/reports', label: 'Reports Center', title: 'Reports Center' },
    { to: '/reports/export', label: 'Export Center', title: 'Export Center' },
  ] },
  { group: 'Administration', items: [
    { to: '/admin/settings', label: 'Settings', title: 'Settings' },
    { to: '/admin/data', label: 'Data Management', title: 'Data Management' },
    { to: '/admin/audit', label: 'Audit Trail', title: 'Audit Trail' },
  ] },
];

function Sidebar({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  const { canEdit } = useWorkspace();
  const modal = useModal();
  return (
    <aside className={'sidebar' + (open ? ' mobile-open' : '')}>
      <div className="brand">
        <div className="brand-mark"><img src="/tbc-mark.png" alt="TBC" /></div>
        <div className="brand-name">THE BOARD CONSULTING</div>
        <div className="brand-tag">Insights . Strategy . Impact</div>
      </div>
      <nav className="nav-scroll">
        {NAV.map((g, gi) => (
          <div key={gi} className={g.group ? 'nav-group' : undefined}>
            {g.group && (
              <div className="nav-group-label">{g.group}
                {g.group === 'Talents' && canEdit && <button className="nav-add-btn" title="Add new talent" onClick={() => modal.open(<AddTalentModal />)}>+</button>}
              </div>
            )}
            {g.items.map((it) => (
              <NavLink key={it.to} to={it.to} end onClick={onNavigate} className={({ isActive }) => (it.primary ? 'nav-primary' : 'nav-item') + (isActive ? ' active' : '')}
                style={it.to === '/copilot' ? { background: 'linear-gradient(90deg, rgba(237,36,41,0.14), transparent)', borderColor: '#4A2130' } : undefined}>
                {!it.primary && !it.label.startsWith('➕') && <span className="dot" />}{it.label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <div className="sidebar-footer">© {new Date().getFullYear()} The Board Consulting</div>
    </aside>
  );
}

function useClickOutside(ref: React.RefObject<HTMLElement>, onOut: () => void) {
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onOut(); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [ref, onOut]);
}

function Search() {
  const { model } = useWorkspace();
  const modal = useModal();
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setQ(''));
  const s = q.trim().toLowerCase();
  const engs = s ? model.engagements.filter((e) => (e.name + ' ' + e.client).toLowerCase().includes(s)).slice(0, 6) : [];
  const tals = s ? model.talents.filter((t) => (t.name + ' ' + t.title).toLowerCase().includes(s)).slice(0, 5) : [];
  const clis = s ? model.clients().filter((c) => c.name.toLowerCase().includes(s)).slice(0, 5) : [];
  const go = (node: ReactNode) => { setQ(''); modal.open(node); };
  return (
    <div className="search-box" style={{ position: 'relative' }} ref={ref}>
      🔍 <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search talents, engagements, clients…" aria-label="Search" />
      {s && (
        <div className="popover" style={{ left: 0, right: 'auto' }}>
          {engs.length > 0 && <div className="popover-head">Engagements</div>}
          {engs.map((e) => <div key={e.id} className="popover-row" onClick={() => go(<EngagementModal id={e.id} />)}><div style={{ fontSize: 12, fontWeight: 600 }}>{e.name}</div><div className="small muted">{e.client} · {model.bucket(e)}</div></div>)}
          {tals.length > 0 && <div className="popover-head">Talents</div>}
          {tals.map((t) => <div key={t.id} className="popover-row" onClick={() => go(<TalentModal id={t.id} />)}><div style={{ fontSize: 12, fontWeight: 600 }}>{t.name}</div><div className="small muted">{t.title} · {t.department}</div></div>)}
          {clis.length > 0 && <div className="popover-head">Clients</div>}
          {clis.map((c) => <div key={c.id} className="popover-row" onClick={() => go(<ClientModal id={c.id} />)}><div style={{ fontSize: 12, fontWeight: 600 }}>{c.name}</div><div className="small muted">{c.active} active</div></div>)}
          {!engs.length && !tals.length && !clis.length && <div className="empty-state" style={{ padding: 16 }}>No matches for “{q}”</div>}
        </div>
      )}
    </div>
  );
}

function Notifications() {
  const { model } = useWorkspace();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false));
  const alerts = model.alerts();
  return (
    <div className="icon-btn" ref={ref} style={{ position: 'relative', cursor: 'pointer' }} onClick={() => setOpen(!open)} title="Alerts">
      🔔{alerts.length > 0 && <span className="badge-dot">{alerts.length}</span>}
      {open && (
        <div className="popover" onClick={(e) => e.stopPropagation()}>
          <div className="popover-head">Alerts ({alerts.length})</div>
          {alerts.length ? alerts.map((a, i) => (
            <div key={i} className="popover-row" onClick={() => { setOpen(false); if (a.link) nav(a.link); }}>
              <div style={{ fontSize: 11.5, fontWeight: 600 }}>{a.icon} {a.title}</div>
              <div className="small muted" style={{ marginTop: 3, lineHeight: 1.4 }}>{a.desc}</div>
            </div>
          )) : <div className="empty-state" style={{ padding: 16 }}>✅ No active alerts</div>}
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const { user, setUser } = useWorkspace();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false));
  const initials = user.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div className="user-chip" ref={ref} style={{ position: 'relative', cursor: 'pointer' }} onClick={() => setOpen(!open)}>
      <Avatar text={initials} size={30} />
      <div><div className="uname">{user.name}</div><div className="urole">{user.role === 'viewer' ? 'Viewing' : user.role === 'admin' ? 'Admin' : 'Editing'}</div></div>
      {open && (
        <div className="user-menu" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => { setOpen(false); nav('/admin/settings'); }}>⚙ Settings & password</button>
          <button onClick={async () => { await api.post('/auth/logout'); setUser(null); }}>↪ Sign out</button>
        </div>
      )}
    </div>
  );
}

export function Layout() {
  const { data, live, canEdit, act, refresh, user } = useWorkspace();
  const loc = useLocation();
  const [menu, setMenu] = useState(false);
  const [spin, setSpin] = useState(false);
  const page = NAV.flatMap((g) => g.items.map((i) => ({ ...i, group: g.group ?? 'Engagement Excellence OS' }))).find((i) => i.to === loc.pathname);
  useEffect(() => { window.scrollTo(0, 0); }, [loc.pathname]);
  useEffect(() => { document.title = `${page?.title ?? 'EEOS'} · EEOS`; }, [page]);
  const last = data.updatedAt ? new Date(data.updatedAt) : null;
  return (
    <div className="app">
      <div className={'mobile-sidebar-backdrop' + (menu ? ' show' : '')} onClick={() => setMenu(false)} />
      <Sidebar open={menu} onNavigate={() => setMenu(false)} />
      <main className="main">
        <header className="topbar">
          <button className="mobile-menu-btn" aria-label="Open menu" onClick={() => setMenu(!menu)}>☰</button>
          <div className="topbar-title"><h1>{page?.group === 'Engagement Excellence OS' && page.to === '/' ? 'Engagement Excellence OS' : page?.group ?? 'EEOS'}</h1><p>{page?.title ?? ''}</p></div>
          <div className="topbar-right">
            <div className="pill-btn" style={{ fontSize: 10.5, color: live ? 'var(--text-faint)' : 'var(--warn)' }} title={live ? 'Live — changes from teammates appear automatically' : 'Reconnecting to live updates…'}>
              {live ? '🟢' : '🟠'} {last ? `Last edit: ${data.updatedBy?.startsWith('Seed') ? 'import' : data.updatedBy} · ${last.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Live'}
            </div>
            <button className="icon-btn" title="Refresh" onClick={async () => { setSpin(true); await refresh(); setTimeout(() => setSpin(false), 600); }}><span className={spin ? 'spin' : ''} style={{ display: 'inline-block' }}>🔄</span></button>
            {canEdit && <button className="icon-btn" title="Undo your last change" onClick={() => act(() => api.post('/audit/undo-last'), 'Your last change was undone')}>↩️</button>}
            <Search />
            <Notifications />
            <UserMenu />
          </div>
        </header>
        <div className="content">
          <svg className="view-watermark" viewBox="0 0 1280 720" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
            <defs>
              <linearGradient id="wmGrad1" x1="0%" y1="0%" x2="100%" y2="60%"><stop offset="0%" stopColor="#3730A3" /><stop offset="60%" stopColor="#5B5AC4" /><stop offset="100%" stopColor="#8B6FDE" /></linearGradient>
              <linearGradient id="wmGrad2" x1="100%" y1="0%" x2="0%" y2="60%"><stop offset="0%" stopColor="#6C68D6" /><stop offset="100%" stopColor="#2B2D6E" /></linearGradient>
            </defs>
            <g className="wm-ribbon-a"><path d="M -100,420 C 150,300 300,520 500,400 C 700,280 800,500 1000,380 C 1150,300 1250,340 1400,260" fill="none" stroke="url(#wmGrad1)" strokeWidth="34" strokeLinecap="round" opacity="0.85" /></g>
            <g className="wm-ribbon-b"><path d="M -100,560 C 150,470 320,610 520,520 C 720,430 850,600 1050,510 C 1180,450 1280,480 1400,420" fill="none" stroke="url(#wmGrad2)" strokeWidth="22" strokeLinecap="round" opacity="0.6" /></g>
          </svg>
          {user.role === 'viewer' && <div className="viewer-banner">👁 View-only access. Ask an admin for editor access to make changes.</div>}
          <section className="view"><Outlet /></section>
        </div>
      </main>
    </div>
  );
}
