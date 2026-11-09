import { useState } from 'react';
import { DEPARTMENTS, TITLES } from '../../../shared/constants';
import { stageLabel } from '../../../shared/schedule';
import type { CapacityRule, Talent } from '../../../shared/types';
import { EngagementModal, TalentModal } from '../components/modals';
import { Card, Confirm, Empty, ListRow, PageHead, Stat, Tag, useModal } from '../components/ui';
import { api, downloadFile } from '../lib/api';
import { useWorkspace } from '../lib/workspace';

export default function DataManagement() {
  const [tab, setTab] = useState<'live' | 'capacity' | 'roster' | 'trajectory' | 'backup'>('live');
  const { isAdmin } = useWorkspace();
  return (
    <>
      <PageHead title="Data Management" desc="Everything that has been overridden, removed or closed — plus the reference data EEOS runs on." />
      <div className="tabs">
        {([['live', '📋 Overrides & archive'], ['capacity', 'Capacity rules'], ['roster', 'Roster'], ['trajectory', 'Staffing history'], ...(isAdmin ? [['backup', 'Backup & restore']] : [])] as [typeof tab, string][]).map(([k, l]) => (
          <button key={k} className={'tab' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'live' && <LiveData />}
      {tab === 'capacity' && <CapacityRules />}
      {tab === 'roster' && <Roster />}
      {tab === 'trajectory' && <Trajectory />}
      {tab === 'backup' && <Backup />}
    </>
  );
}

function Section({ title, children, count }: { title: string; count: number; children: React.ReactNode }) {
  return <Card title={`${title} (${count})`} style={{ marginBottom: 14 }}>{count ? children : <Empty>Nothing here.</Empty>}</Card>;
}

function LiveData() {
  const { model: m, canEdit, act } = useWorkspace();
  const modal = useModal();
  const [q, setQ] = useState('');
  const match = (...s: string[]) => !q || s.join(' ').toLowerCase().includes(q.toLowerCase());
  const all = m.data.engagements;
  const removed = m.data.talents.filter((t) => t.status === 'removed' && match(t.name, t.title));
  const deleted = all.filter((e) => e.status === 'deleted' && match(e.name, e.client));
  const closed = all.filter((e) => e.status === 'closed' && !e.historical && match(e.name, e.client));
  const paused = all.filter((e) => e.status === 'paused' && match(e.name, e.client));
  const flags = m.talents.filter((t) => t.flag && match(t.name));
  const utilOv = m.talents.filter((t) => t.utilOverride && match(t.name));
  const allocOv = m.engagements.flatMap((e) => Object.entries(e.allocationOverrides).map(([tid, pct]) => ({ e, tid, pct }))).filter((x) => match(x.e.name, m.name(x.tid)));
  const cps = m.engagements.filter((e) => e.customCps && match(e.name));
  const btn = (label: string, fn: () => void, danger = false) => canEdit ? <button className={'btn btn-sm' + (danger ? ' btn-danger-outline' : '')} onClick={(x) => { x.stopPropagation(); fn(); }}>{label}</button> : null;
  return (
    <>
      <div className="stat-strip">
        <Stat value={m.talents.length} label="Talents" /><Stat value={m.active.length} label="Active engagements" /><Stat value={m.clients().length} label="Clients" />
        <Stat value={utilOv.length + allocOv.length + flags.length} label="Live overrides" /><Stat value={removed.length + deleted.length} label="Restorable" />
      </div>
      <div className="filters-bar"><input type="text" placeholder="Search all records…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <Section title="Removed talents" count={removed.length}>{removed.map((t) => <ListRow key={t.id} title={t.name} desc={`${t.title} · ${t.department}`} right={btn('↺ Restore', () => act(() => api.post(`/talents/${t.id}/restore`), `${t.name} restored`))} />)}</Section>
      <Section title="Deleted engagements" count={deleted.length}>{deleted.map((e) => <ListRow key={e.id} title={e.name} desc={e.client} right={btn('↺ Restore', () => act(() => api.post(`/engagements/${e.id}/restore`), 'Engagement restored'))} />)}</Section>
      <Section title="Paused engagements" count={paused.length}>{paused.map((e) => <ListRow key={e.id} title={e.name} desc={`${e.client} · ${stageLabel(e.stage)}`} onClick={() => modal.open(<EngagementModal id={e.id} />)} right={btn('▶ Resume', () => act(() => api.post(`/engagements/${e.id}/resume`), 'Resumed'))} />)}</Section>
      <Section title="Manually closed engagements" count={closed.length}>{closed.map((e) => <ListRow key={e.id} title={e.name} desc={e.client} onClick={() => modal.open(<EngagementModal id={e.id} />)} right={btn('↺ Reopen', () => act(() => api.post(`/engagements/${e.id}/reopen`), 'Reopened'))} />)}</Section>
      <Section title="Reallocation flags" count={flags.length}>{flags.map((t) => <ListRow key={t.id} title={t.name} desc={`Flagged by ${t.flag!.by}`} onClick={() => modal.open(<TalentModal id={t.id} />)} right={btn('Unflag', () => act(() => api.put(`/talents/${t.id}/flag`, { flagged: false }), 'Unflagged'), true)} />)}</Section>
      <Section title="Manual utilization overrides" count={utilOv.length}>{utilOv.map((t) => <ListRow key={t.id} title={t.name} desc={`Set to ${t.utilOverride!.value}% by ${t.utilOverride!.by}${t.utilOverride!.reason ? ` — “${t.utilOverride!.reason}”` : ''} (computed: ${t.computedUtil}%)`} right={btn('Clear', () => act(() => api.put(`/talents/${t.id}/utilization-override`, { value: null }), 'Override cleared'), true)} />)}</Section>
      <Section title="Manual allocation overrides" count={allocOv.length}>{allocOv.map((x) => <ListRow key={x.e.id + x.tid} title={`${m.name(x.tid)} → ${x.e.name}`} desc={`${x.pct}% allocated`} right={btn('Clear', () => act(() => api.put(`/engagements/${x.e.id}/allocations/${x.tid}`, { pct: null }), 'Back to tier default'), true)} />)}</Section>
      <Section title="Uploaded CPS schedules" count={cps.length}>{cps.map((e) => <ListRow key={e.id} title={e.name} desc={`${e.customCps!.length} stages`} right={btn('Remove', () => act(() => api.put(`/engagements/${e.id}/cps`, { stages: null }), 'Back to auto schedule'), true)} />)}</Section>
    </>
  );
}

function CapacityRules() {
  const { model: m, canEdit, act } = useWorkspace();
  const [adding, setAdding] = useState({ title: TITLES[0], department: DEPARTMENTS[0] });
  const save = (r: CapacityRule, field: 'project' | 'leadership', v: string) => {
    const n = Math.max(0, Math.min(20, Math.round(Number(v) || 0)));
    if (n !== r[field]) act(() => api.put('/capacity-rules', { title: r.title, department: r.department, project: r.project, leadership: r.leadership, [field]: n }), `${r.title} (${r.department}) updated`);
  };
  return (
    <Card>
      <div className="section-desc" style={{ marginTop: 0 }}>Maximum concurrent engagements per title × department. Changes apply everywhere immediately. Rows marked <i>estimate</i> still need confirmation.</div>
      <table className="data">
        <thead><tr><th>Title</th><th>Department</th><th>Project capacity</th><th>Leadership capacity</th><th /></tr></thead>
        <tbody>{m.orderedRules().map((r) => (
          <tr key={r.title + r.department} style={{ cursor: 'default' }}>
            <td><b>{r.title}</b></td><td><Tag className="tag-neutral">{r.department}</Tag></td>
            <td><input className="inline-input" type="number" min={0} max={20} defaultValue={r.project} disabled={!canEdit} style={{ width: 64 }} onBlur={(e) => save(r, 'project', e.target.value)} /></td>
            <td><input className="inline-input" type="number" min={0} max={20} defaultValue={r.leadership} disabled={!canEdit} style={{ width: 64 }} onBlur={(e) => save(r, 'leadership', e.target.value)} /></td>
            <td>{r.placeholder && <Tag className="tag-warn">estimate</Tag>}</td>
          </tr>
        ))}</tbody>
      </table>
      {canEdit && (
        <div className="row" style={{ marginTop: 12 }}>
          <span className="small muted">Add a rule:</span>
          <select className="inline-input" value={adding.title} onChange={(e) => setAdding({ ...adding, title: e.target.value })}>{TITLES.map((t) => <option key={t}>{t}</option>)}</select>
          <select className="inline-input" value={adding.department} onChange={(e) => setAdding({ ...adding, department: e.target.value })}>{DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}</select>
          <button className="btn btn-sm" disabled={m.capacity(adding.title, adding.department).defined} onClick={() => act(() => api.put('/capacity-rules', { ...adding, project: 4, leadership: 1 }), 'Rule added — adjust the numbers above')}>Add</button>
        </div>
      )}
    </Card>
  );
}

function Roster() {
  const { model: m, canEdit, act } = useWorkspace();
  const save = (t: Talent, patch: Partial<Talent>) => act(() => api.patch(`/talents/${t.id}`, patch), 'Talent record updated');
  const rows = m.data.talents.filter((t) => t.status === 'active');
  return (
    <Card>
      <div className="section-desc" style={{ marginTop: 0 }}>Name, title and department for everyone on the roster. Corrections apply everywhere — engagements reference people by ID, so renames are safe.</div>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Name</th><th>Title</th><th>Department</th></tr></thead>
          <tbody>{rows.map((t) => (
            <tr key={t.id} style={{ cursor: 'default' }}>
              <td><input className="inline-input" defaultValue={t.name} disabled={!canEdit} style={{ width: 200 }} onBlur={(e) => e.target.value.trim() && e.target.value !== t.name && save(t, { name: e.target.value.trim() })} /></td>
              <td><select className="inline-input" value={t.title} disabled={!canEdit} onChange={(e) => save(t, { title: e.target.value })}>{TITLES.map((x) => <option key={x}>{x}</option>)}</select></td>
              <td><select className="inline-input" value={t.department} disabled={!canEdit} onChange={(e) => save(t, { department: e.target.value })}>{DEPARTMENTS.map((x) => <option key={x}>{x}</option>)}</select></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </Card>
  );
}

function Trajectory() {
  const { model: m } = useWorkspace();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const SIZE = 25;
  const rows = m.data.trajectory.filter((r) => !q || Object.values(r).join(' ').toLowerCase().includes(q.toLowerCase()));
  const pages = Math.max(1, Math.ceil(rows.length / SIZE));
  const p = Math.min(page, pages - 1);
  return (
    <Card>
      <div className="section-desc" style={{ marginTop: 0 }}>{m.data.trajectory.length} imported monthly staffing records — the source for historical engagements, sector experience and pairing history. Read-only.</div>
      <div className="filters-bar"><input type="text" placeholder="Search staffing records…" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} /></div>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Year</th><th>Month</th><th>Engagement</th><th>Client</th><th>Sector</th><th>Scope</th><th>Status</th><th>Talent</th><th>Title</th><th>Role</th></tr></thead>
          <tbody>{rows.slice(p * SIZE, (p + 1) * SIZE).map((r) => <tr key={r.id} style={{ cursor: 'default' }}><td>{r.year}</td><td>{r.month}</td><td>{r.engagement}</td><td>{r.client}</td><td>{r.sector}</td><td>{r.scope}</td><td>{r.status}</td><td>{r.talent}</td><td>{r.title}</td><td>{r.role}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="row" style={{ justifyContent: 'space-between', paddingTop: 12 }}>
        <span className="small muted">{rows.length ? p * SIZE + 1 : 0}–{Math.min(rows.length, (p + 1) * SIZE)} of {rows.length}</span>
        <div className="row"><button className="btn btn-sm" disabled={p <= 0} onClick={() => setPage(p - 1)}>← Prev</button><span className="small">Page {p + 1} / {pages}</span><button className="btn btn-sm" disabled={p >= pages - 1} onClick={() => setPage(p + 1)}>Next →</button></div>
      </div>
    </Card>
  );
}

function Backup() {
  const { act } = useWorkspace();
  const modal = useModal();
  const [msg, setMsg] = useState('');
  const download = async () => {
    const data = await api.get('/admin/backup');
    downloadFile(`eeos-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 1), 'application/json');
  };
  const restore = async (file: File) => {
    let seed: unknown;
    try { seed = JSON.parse(await file.text()); } catch { setMsg('That file is not valid JSON.'); return; }
    modal.open(<Confirm title="Replace all data?" danger confirmLabel="Replace everything" message={<>This replaces every talent, engagement, client, capacity rule and staffing record with the contents of <b>{file.name}</b>. User accounts are kept. Download a backup first if unsure.</>}
      onConfirm={() => act(() => api.post('/admin/restore', seed), 'Data restored from file')} />);
  };
  return (
    <Card>
      <div className="sub-label" style={{ marginTop: 0 }}>Backup</div>
      <p className="small" style={{ color: 'var(--text-dim)', marginBottom: 10 }}>Download every talent, engagement, client, capacity rule and staffing record as one JSON file. The same format is produced by the prototype importer.</p>
      <button className="btn btn-primary btn-sm" onClick={download}>⬇ Download backup</button>
      <div className="sub-label">Restore / import</div>
      <p className="small" style={{ color: 'var(--text-dim)', marginBottom: 10 }}>Load a backup or a seed file produced by <code>npm run import:artifact</code>. This replaces all business data.</p>
      <input type="file" accept=".json,application/json" onChange={(e) => e.target.files?.[0] && restore(e.target.files[0])} />
      {msg && <div className="error-text">{msg}</div>}
      <div className="sub-label">Reset to demo data</div>
      <button className="btn btn-danger-outline btn-sm" onClick={() => modal.open(<Confirm title="Reset to demo data?" danger confirmLabel="Reset" message="Replace all business data with the anonymized demo dataset? User accounts are kept." onConfirm={() => act(() => api.post('/admin/reset-demo'), 'Reset to demo data')} />)}>Reset everything to demo data</button>
    </Card>
  );
}
