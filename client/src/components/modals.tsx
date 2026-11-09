import { useEffect, useState, type ReactNode } from 'react';
import { DEPARTMENTS, LIFECYCLE, SCOPES, SCOPE_STAGES, TITLES, WORKLOAD_TIERS, WORKLOAD_TIER_NAMES } from '../../../shared/constants';
import { fmtMoney, type Model } from '../../../shared/engine';
import { parseCpsCsv, scopeStages, stageLabel } from '../../../shared/schedule';
import type { Engagement } from '../../../shared/types';
import { api } from '../lib/api';
import { useWorkspace } from '../lib/workspace';
import { Bars, CpsBar, LineChart } from './charts';
import { Avatar, Confirm, Empty, ListRow, ModalFrame, Stat, Tag, fmtDate, healthClass, priorityClass, statusColor, useModal } from './ui';

// ---------------- reusable team picker ----------------
export function TeamPicker({ model, leadId, teamIds, supervisorId, onChange }: {
  model: Model; leadId: string; teamIds: string[]; supervisorId: string | null;
  onChange: (v: { leadId: string; teamIds: string[]; supervisorId: string | null }) => void;
}) {
  const staffable = model.talents.filter((t) => t.department !== 'Operations');
  const overlaps = model.overlapsWithActive([leadId, ...teamIds]);
  const toggle = (id: string) => onChange({ leadId, supervisorId, teamIds: teamIds.includes(id) ? teamIds.filter((x) => x !== id) : [...teamIds, id] });
  return (
    <>
      <div className="form-grid">
        <div className="form-field">
          <label>Engagement Lead</label>
          <select value={leadId} onChange={(e) => onChange({ leadId: e.target.value, teamIds: teamIds.includes(e.target.value) ? teamIds : [e.target.value, ...teamIds], supervisorId: supervisorId === e.target.value ? null : supervisorId })}>
            {staffable.map((t) => <option key={t.id} value={t.id}>{t.name} — {t.util}%</option>)}
          </select>
        </div>
        <div className="form-field">
          <label>Supervisor (optional — flat 15%)</label>
          <select value={supervisorId ?? ''} onChange={(e) => {
            const sup = e.target.value || null;
            onChange({ leadId, supervisorId: sup, teamIds: teamIds.filter((x) => x !== sup) });
          }}>
            <option value="">— No supervisor —</option>
            {staffable.filter((t) => t.id !== leadId).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div className="form-field full">
          <label>Team members — <span style={{ color: 'var(--accent)' }}>{teamIds.length} selected</span></label>
          <div className="checkbox-grid" style={{ maxHeight: 180, overflowY: 'auto' }}>
            {model.talents.filter((t) => t.id !== supervisorId).map((t) => (
              <div key={t.id} className={'chip-check' + (teamIds.includes(t.id) ? ' on' : '')} onClick={() => toggle(t.id)} title={`${t.title} · ${t.util}% utilized`}>
                {t.name}{t.department === 'Operations' && <span className="muted" style={{ fontSize: 9 }}> (Ops)</span>}
                <span style={{ fontSize: 9, color: statusColor(t.utilStatus) }}> {t.util}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      {overlaps.length > 0 && (
        <div style={{ background: 'rgba(237,36,41,0.1)', border: '1px solid rgba(237,36,41,0.3)', borderRadius: 9, padding: '10px 13px', fontSize: 11.5, color: 'var(--text-dim)', marginTop: 10 }}>
          🔁 <b style={{ color: 'var(--danger)' }}>Rotation note:</b> some of these people already work together —{' '}
          {overlaps.slice(0, 2).map((o) => `${o.shared.join(' + ')} on ${o.engagement}`).join('; ')}{overlaps.length > 2 ? `, +${overlaps.length - 2} more` : ''}. Consider rotating someone new in.
        </div>
      )}
    </>
  );
}

// ---------------- engagement ----------------
export function EngagementModal({ id }: { id: string }) {
  const { model, canEdit, act } = useWorkspace();
  const modal = useModal();
  const e = model.engagement(id);
  const [tab, setTab] = useState<'overview' | 'team' | 'schedule' | 'details'>('overview');
  if (!e) return <ModalFrame title="Engagement">This engagement no longer exists.</ModalFrame>;
  const editable = canEdit && !e.historical && e.status !== 'deleted';
  const bucket = model.bucket(e);
  const stages = scopeStages(e.scope);
  const next = stages[stages.findIndex((s) => s.id === e.stage) + 1];
  const h = model.health(e);
  const fin = model.financials(e);
  const statusAction = (action: string, msg: string) => act(() => api.post(`/engagements/${id}/${action}`), msg);
  const confirm = (title: string, message: ReactNode, label: string, action: string, msg: string) =>
    modal.open(<Confirm title={title} message={message} confirmLabel={label} danger onConfirm={() => statusAction(action, msg)} />);

  const footer = !editable ? (
    <span className="muted small" style={{ alignSelf: 'center' }}>{e.historical ? '📁 Historical record — read only' : !canEdit ? '👁 View only' : '🗑 Deleted'}</span>
  ) : (
    <>
      {bucket === 'active' && next && <button className="btn btn-primary btn-sm" onClick={() => act(() => api.post(`/engagements/${id}/advance`), `Advanced to ${next.label}`)}>Advance to {next.label} →</button>}
      {bucket === 'active' && !next && <span style={{ fontSize: 11.5, color: 'var(--ok)', alignSelf: 'center', fontWeight: 600 }}>✅ Final stage reached</span>}
      {bucket === 'paused' && <button className="btn btn-primary btn-sm" onClick={() => statusAction('resume', 'Engagement resumed')}>▶ Resume</button>}
      {bucket === 'closed' && <button className="btn btn-sm" onClick={() => statusAction('reopen', 'Engagement reopened')}>↺ Reopen</button>}
      {bucket === 'active' && <button className="btn btn-sm" onClick={() => statusAction('pause', 'Engagement paused')}>⏸ Pause</button>}
      {(bucket === 'active' || bucket === 'paused') && (
        <button className="btn btn-danger-outline btn-sm" onClick={() => confirm('Close engagement?', <>Close <b>{e.name}</b>? It stops counting toward KPIs and utilization everywhere. You can reopen it later.</>, '🔒 Close it', 'close', 'Engagement closed')}>🔒 Close</button>
      )}
      <button className="btn btn-danger-outline btn-sm" onClick={() => confirm('Delete engagement?', <>Delete <b>{e.name}</b>? Use this only for mistakes or duplicates — it disappears everywhere. It can be restored from Data Management or undone.</>, '🗑 Delete', 'delete', 'Engagement deleted')}>🗑</button>
    </>
  );

  return (
    <ModalFrame wide title={e.name} footer={footer}>
      <div className="pill-row" style={{ marginBottom: 14 }}>
        <span className="mini-pill">{e.client}</span><span className="mini-pill">{e.sector}</span>
        <span className="mini-pill">{SCOPE_STAGES[e.scope as keyof typeof SCOPE_STAGES]?.icon} {e.scope}{e.subScope ? ' · ' + e.subScope : ''}</span>
        {bucket === 'historical' ? <Tag className="tag-neutral">📁 Historical</Tag> : bucket === 'closed' ? <Tag className="tag-neutral">🔒 Closed</Tag> : bucket === 'paused' ? <Tag className="tag-warn">⏸ Paused</Tag> : <Tag className={healthClass(h)}>{h}</Tag>}
        {bucket === 'active' && <Tag className={priorityClass(model.priority(e))}>{model.priority(e)} priority</Tag>}
        {e.status === 'deleted' && <Tag className="tag-danger">Deleted</Tag>}
      </div>
      <div className="tabs">
        {(['overview', 'team', 'schedule', 'details'] as const).map((t) => <button key={t} className={'tab' + (tab === t ? ' on' : '')} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}
      </div>

      {tab === 'overview' && (
        <>
          <div className="kv">Lead: <b>{model.name(e.leadId)}</b> · Team: {e.teamIds.map((x) => model.name(x)).join(', ')}{e.supervisorId && <> · Supervisor: <b>{model.name(e.supervisorId)}</b></>}</div>
          <div className="sub-label">Critical path schedule</div>
          <CpsBar model={model} e={e} />
          {editable && bucket === 'active' && (
            <div className="box" style={{ marginTop: 12 }}>
              <label className="small muted">Jump directly to any stage</label>
              <div className="row" style={{ marginTop: 6 }}>
                <select className="inline-input" style={{ flex: 1 }} defaultValue={e.stage} id="stage-select">
                  {LIFECYCLE.map((s) => <option key={s.id} value={s.id}>{s.icon} {s.label}{stages.some((x) => x.id === s.id) ? '' : ' (outside scope)'}</option>)}
                </select>
                <button className="btn btn-primary btn-sm" onClick={() => {
                  const stage = (document.getElementById('stage-select') as HTMLSelectElement).value;
                  if (stage !== e.stage) act(() => api.put(`/engagements/${id}/stage`, { stage }), `Stage set to ${stageLabel(stage)}`);
                }}>Set stage</button>
              </div>
            </div>
          )}
          <div className="sub-label">💰 Profitability</div>
          <Financials e={e} editable={canEdit && e.status !== 'deleted'} />
          {fin && (
            <div className="stat-strip" style={{ marginTop: 10 }}>
              <Stat value={fmtMoney(fin.price)} label="Selling price" />
              <Stat value={fmtMoney(fin.cost)} label="Cost" />
              <Stat value={fmtMoney(fin.grossProfit)} label="Gross profit" color={fin.grossProfit >= 0 ? 'var(--ok)' : 'var(--danger)'} />
              <Stat value={fin.profitabilityPct + '%'} label="Margin" color={fin.profitabilityPct >= 0 ? 'var(--ok)' : 'var(--danger)'} />
            </div>
          )}
          <div className="sub-label">Notes</div>
          <div style={{ fontSize: 12.5, color: 'var(--text-dim)', whiteSpace: 'pre-wrap' }}>{e.notes || 'No notes recorded.'}</div>
        </>
      )}

      {tab === 'team' && <TeamTab e={e} editable={editable} />}
      {tab === 'schedule' && <ScheduleTab e={e} editable={editable} />}
      {tab === 'details' && <DetailsTab e={e} editable={editable} />}
    </ModalFrame>
  );
}

function Financials({ e, editable }: { e: Engagement; editable: boolean }) {
  const { act } = useWorkspace();
  const [price, setPrice] = useState(e.price?.toString() ?? '');
  const [cost, setCost] = useState(e.cost?.toString() ?? '');
  useEffect(() => { setPrice(e.price?.toString() ?? ''); setCost(e.cost?.toString() ?? ''); }, [e.price, e.cost]);
  if (!editable) return e.price === null ? <div className="muted small">No financials recorded.</div> : null;
  return (
    <div className="row">
      <input className="inline-input" type="number" min={0} placeholder="Selling price" value={price} onChange={(x) => setPrice(x.target.value)} style={{ width: 140 }} />
      <input className="inline-input" type="number" min={0} placeholder="Cost" value={cost} onChange={(x) => setCost(x.target.value)} style={{ width: 140 }} />
      <button className="btn btn-sm" onClick={() => act(() => api.put(`/engagements/${e.id}/financials`, { price: price === '' ? null : Number(price), cost: cost === '' ? null : Number(cost) }), 'Profitability saved')}>Save</button>
    </div>
  );
}

function TeamTab({ e, editable }: { e: Engagement; editable: boolean }) {
  const { model, act } = useWorkspace();
  const [team, setTeam] = useState({ leadId: e.leadId, teamIds: e.teamIds, supervisorId: e.supervisorId });
  const members = model.members(e);
  return (
    <>
      <div className="sub-label">Allocation on this engagement</div>
      {members.map((tid) => (
        <ListRow key={tid} icon={model.talentById.get(tid)?.initials ?? '?'} title={model.name(tid)}
          desc={tid === e.leadId ? 'Lead' : tid === e.supervisorId ? 'Supervisor' : 'Team member'}
          right={<span className="tag tag-neutral">{model.allocationPct(tid, e)}%{e.allocationOverrides[tid] !== undefined ? ' ✋' : ''}</span>} />
      ))}
      <div className="row" style={{ marginTop: 10 }}>
        <span className="small muted">Workload tier:</span>
        <select className="inline-input" disabled={!editable} value={e.workloadTier} onChange={(x) => act(() => api.put(`/engagements/${e.id}/workload`, { tier: x.target.value }), 'Workload tier updated')}>
          {WORKLOAD_TIER_NAMES.map((t) => <option key={t} value={t}>{WORKLOAD_TIERS[t].icon} {t} ({WORKLOAD_TIERS[t].member}%{WORKLOAD_TIERS[t].leader !== WORKLOAD_TIERS[t].member ? ` / ${WORKLOAD_TIERS[t].leader}% lead` : ''})</option>)}
        </select>
      </div>
      {editable && (
        <>
          <div className="sub-label">Edit team</div>
          <TeamPicker model={model} {...team} onChange={setTeam} />
          <button className="btn btn-primary btn-sm" style={{ marginTop: 10 }} onClick={() => act(() => api.put(`/engagements/${e.id}/team`, team), 'Team updated')}>Save team</button>
        </>
      )}
    </>
  );
}

function ScheduleTab({ e, editable }: { e: Engagement; editable: boolean }) {
  const { model, act } = useWorkspace();
  const [msg, setMsg] = useState<ReactNode>(null);
  const onFile = async (file: File) => {
    const { parsed, unmatched } = parseCpsCsv(await file.text(), e.scope, e.start);
    if (!parsed.length) return setMsg(<span style={{ color: 'var(--danger)' }}>No valid rows found. Expected columns: Activity, Start Week, End Week, Owner (optional), using this scope's stage names.</span>);
    const ok = await act(() => api.put(`/engagements/${e.id}/cps`, { stages: parsed }), 'Weekly schedule uploaded');
    if (ok) setMsg(<span style={{ color: 'var(--ok)' }}>Loaded {parsed.length} stages.{unmatched.length ? ` Skipped: ${unmatched.join(', ')}.` : ''}</span>);
  };
  return (
    <>
      <CpsBar model={model} e={e} />
      <table className="data" style={{ marginTop: 12 }}>
        <thead><tr><th>Stage</th><th>Start</th><th>End</th><th>Owner</th></tr></thead>
        <tbody>{model.schedule(e)?.cps.map((s) => <tr key={s.id} style={{ cursor: 'default' }}><td>{s.label}</td><td>{fmtDate(s.start)}</td><td>{fmtDate(s.end)}</td><td>{s.owner ?? '—'}</td></tr>)}</tbody>
      </table>
      {editable && (
        <div className="box" style={{ marginTop: 12 }}>
          <div className="small muted" style={{ marginBottom: 6 }}>
            Upload the real weekly plan (CSV: <code>Activity, Start Week, End Week, Owner</code>) — weeks count from {fmtDate(e.start)}. Stage names: {scopeStages(e.scope).map((s) => s.label).join(', ')}.
          </div>
          <div className="row">
            <input type="file" accept=".csv,text/csv" onChange={(x) => x.target.files?.[0] && onFile(x.target.files[0])} />
            {e.customCps && <button className="btn btn-danger-outline btn-sm" onClick={() => act(() => api.put(`/engagements/${e.id}/cps`, { stages: null }), 'Back to the auto-projected schedule')}>Remove upload</button>}
          </div>
          {msg && <div className="small" style={{ marginTop: 6 }}>{msg}</div>}
        </div>
      )}
    </>
  );
}

function DetailsTab({ e, editable }: { e: Engagement; editable: boolean }) {
  const { act } = useWorkspace();
  const [f, setF] = useState({ name: e.name, client: e.client, country: e.country, sector: e.sector, scope: e.scope, subScope: e.subScope ?? '', start: e.start, end: e.end, notes: e.notes });
  const set = (k: keyof typeof f) => (x: { target: { value: string } }) => setF({ ...f, [k]: x.target.value });
  const strat = f.scope === 'Strategy' || f.scope === 'Research and Strategy';
  return (
    <fieldset disabled={!editable} style={{ border: 'none' }}>
      <div className="form-grid">
        <div className="form-field full"><label>Name</label><input value={f.name} onChange={set('name')} /></div>
        <div className="form-field"><label>Client</label><input value={f.client} onChange={set('client')} /></div>
        <div className="form-field"><label>Country</label><input value={f.country} onChange={set('country')} /></div>
        <div className="form-field"><label>Sector</label><input value={f.sector} onChange={set('sector')} /></div>
        <div className="form-field"><label>Scope</label><select value={f.scope} onChange={set('scope')}>{SCOPES.map((s) => <option key={s}>{s}</option>)}</select></div>
        {strat && <div className="form-field"><label>Strategy sub-type</label><input value={f.subScope} onChange={set('subScope')} /></div>}
        <div className="form-field"><label>Start</label><input type="date" value={f.start} onChange={set('start')} /></div>
        <div className="form-field"><label>End</label><input type="date" value={f.end} onChange={set('end')} /></div>
        <div className="form-field full"><label>Notes</label><textarea value={f.notes} onChange={set('notes')} /></div>
      </div>
      {f.scope !== e.scope && <div className="small" style={{ color: 'var(--warn)', marginTop: 8 }}>Changing scope resets an uploaded schedule and may move the stage back to kickoff.</div>}
      {editable && <button className="btn btn-primary btn-sm" style={{ marginTop: 12 }} onClick={() => act(() => api.patch(`/engagements/${e.id}`, { ...f, subScope: strat ? f.subScope || null : null }), 'Details saved')}>Save details</button>}
    </fieldset>
  );
}

// ---------------- talent ----------------
export function TalentModal({ id }: { id: string }) {
  const { model, canEdit, act } = useWorkspace();
  const modal = useModal();
  const t = model.talent(id);
  const [override, setOverride] = useState('');
  const [reason, setReason] = useState('');
  if (!t) {
    const raw = model.talentById.get(id);
    return <ModalFrame title={raw?.name ?? 'Talent'}>{raw ? `${raw.name} is ${raw.status === 'alumni' ? 'a former team member' : 'removed from the roster'} — see Talent Trajectory for history.` : 'Not found.'}</ModalFrame>;
  }
  const year = model.now.getUTCFullYear();
  const months = Array.from({ length: 12 }, (_, m) => model.talentMonthUtil(t, year, m));
  const active = model.active.filter((e) => model.involves(e, t.id));
  return (
    <ModalFrame title={t.name} footer={canEdit && (
      <>
        <button className="btn btn-sm" onClick={() => act(() => api.put(`/talents/${t.id}/flag`, { flagged: !t.flag }), t.flag ? 'Flag removed' : 'Flagged for reallocation')}>{t.flag ? 'Unflag' : '🚩 Flag for reallocation'}</button>
        <button className="btn btn-danger-outline btn-sm" onClick={() => modal.open(<Confirm title="Remove talent?" danger confirmLabel="🗑 Remove"
          message={<>Remove <b>{t.name}</b> from the roster? {t.engagementCount > 0 && <span style={{ color: 'var(--warn)' }}>They are on {t.engagementCount} active engagement(s) — reassign that work first. </span>}History is kept and they can be restored from Data Management.</>}
          onConfirm={() => act(() => api.post(`/talents/${t.id}/remove`), `${t.name} removed from the roster`)} />)}>🗑 Remove</button>
      </>
    )}>
      {t.flag && <div className="viewer-banner">🚩 Flagged for reallocation by {t.flag.by} on {fmtDate(t.flag.at)}</div>}
      <div className="profile-header">
        <div className="profile-avatar">{t.initials}</div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{t.name}</div>
          <div className="muted" style={{ fontSize: 12 }}>{t.title} · {t.department}</div>
          <div className="pill-row">{t.sectors.length ? t.sectors.map((s) => <span key={s} className="mini-pill">{s}</span>) : <span className="mini-pill">No engagement history yet</span>}</div>
        </div>
      </div>
      <div className="stat-strip">
        <Stat value={<>{t.util}%{t.utilOverride && <span style={{ fontSize: 10, color: 'var(--warn)' }}> ✋</span>}</>} label={t.utilStatus} color={statusColor(t.utilStatus)} />
        <Stat value={`${t.engagementCount} / ${t.projectCapacity}`} label="Engagements / capacity" />
        <Stat value={t.leadershipCapacity} label="Leadership capacity" />
      </div>
      <div className="small muted" style={{ lineHeight: 1.6 }}>
        Utilization = the sum of this person's allocation on each active engagement (by workload tier and role, or a manual override) — currently {t.computedUtil}%.
        {t.utilOverride && <><br /><b style={{ color: 'var(--warn)' }}>✋ Manually set to {t.utilOverride.value}%</b> by {t.utilOverride.by} on {fmtDate(t.utilOverride.at)}{t.utilOverride.reason && ` — “${t.utilOverride.reason}”`}.</>}
      </div>
      <div className="sub-label">Current engagements</div>
      {active.length ? active.map((e) => (
        <ListRow key={e.id} title={<>{e.name}{e.leadId === t.id && <span style={{ color: 'var(--accent)', fontSize: 9.5 }}> · Lead</span>}{e.supervisorId === t.id && <span style={{ color: 'var(--lavender)', fontSize: 9.5 }}> · Supervisor</span>}</>}
          desc={`${e.client} · ${stageLabel(e.stage)} · ${model.allocationPct(t.id, e)}%`} right={<Tag className={healthClass(model.health(e))}>{model.health(e)}</Tag>}
          onClick={() => modal.open(<EngagementModal id={e.id} />)} />
      )) : <Empty>Not staffed on any active engagement.</Empty>}
      {canEdit && (
        <div className="row" style={{ margin: '12px 0' }}>
          <input className="inline-input" type="number" min={0} max={200} placeholder="Manual %" value={override} onChange={(x) => setOverride(x.target.value)} style={{ width: 100 }} />
          <input className="inline-input" placeholder="Reason (optional)" value={reason} onChange={(x) => setReason(x.target.value)} style={{ flex: 1, minWidth: 120 }} />
          <button className="btn btn-sm" disabled={override === ''} onClick={() => act(() => api.put(`/talents/${t.id}/utilization-override`, { value: Number(override), reason }), 'Utilization overridden')}>Set manual</button>
          {t.utilOverride && <button className="btn btn-ghost btn-sm" onClick={() => act(() => api.put(`/talents/${t.id}/utilization-override`, { value: null }), 'Back to computed utilization')}>Revert</button>}
        </div>
      )}
      <div className="sub-label">{year} utilization — past months from real engagement dates, future months projected</div>
      <LineChart labels={['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']} series={[{ name: 'Utilization %', color: '#6C68D6', data: months.map((m) => m.value) }]} />
    </ModalFrame>
  );
}

export function AddTalentModal() {
  const { act } = useWorkspace();
  const { close } = useModal();
  const [f, setF] = useState({ name: '', title: TITLES[4], department: DEPARTMENTS[0] });
  return (
    <ModalFrame title="Add new talent" footer={<button className="btn btn-primary btn-sm" disabled={f.name.trim().length < 2}
      onClick={async () => { if (await act(() => api.post('/talents', f), `${f.name} added`)) close(); }}>Add talent</button>}>
      <div className="form-grid">
        <div className="form-field full"><label>Full name</label><input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div className="form-field"><label>Title</label><select value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })}>{TITLES.map((t) => <option key={t}>{t}</option>)}</select></div>
        <div className="form-field"><label>Department</label><select value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })}>{DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}</select></div>
      </div>
    </ModalFrame>
  );
}

/** Full staffing history for one person, from the trajectory log plus app-managed engagements. */
export function TalentHistoryModal({ id }: { id: string }) {
  const { model } = useWorkspace();
  const t = model.talentById.get(id);
  const rows = model.data.trajectory.filter((r) => r.talentId === id).sort((a, b) => b.year - a.year || MONTH_IDX(b.month) - MONTH_IDX(a.month));
  const count = (key: 'sector' | 'scope') => Object.entries(rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r[key]]: (acc[r[key]] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }));
  return (
    <ModalFrame wide title={`${t?.name ?? id} — engagement history`}>
      <div className="stat-strip">
        <Stat value={rows.length} label="Monthly staffing records" />
        <Stat value={new Set(rows.map((r) => r.engagement)).size} label="Distinct engagements" />
        <Stat value={rows.filter((r) => r.role === 'Leader').length} label="Months as leader" />
        <Stat value={count('sector').length} label="Sectors" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <div><div className="panel-title" style={{ marginBottom: 8 }}>By sector</div><Bars rows={count('sector')} /></div>
        <div><div className="panel-title" style={{ marginBottom: 8 }}>By scope</div><Bars rows={count('scope')} /></div>
      </div>
      {rows.length ? rows.map((r) => (
        <ListRow key={r.id} icon={r.role === 'Leader' ? '★' : '📁'} title={r.engagement} desc={`${r.client} · ${r.sector} · ${r.scope} · ${r.role}`}
          right={<div style={{ textAlign: 'right' }}><div className="small muted">{r.month} {r.year}</div><Tag className={r.status === 'Open' ? 'tag-ok' : 'tag-neutral'}>{r.status}</Tag></div>} />
      )) : <Empty>No recorded history for this person.</Empty>}
    </ModalFrame>
  );
}
const MONTH_IDX = (m: string) => ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(m);

// ---------------- lists ----------------
export function EngagementListModal({ title, blurb, ids }: { title: string; blurb?: ReactNode; ids: string[] }) {
  const { model } = useWorkspace();
  const modal = useModal();
  const list = ids.map((i) => model.engagement(i)).filter((e): e is Engagement => !!e);
  return (
    <ModalFrame title={title}>
      <div className="small" style={{ color: 'var(--text-dim)', marginBottom: 12 }}><b style={{ color: 'var(--text)' }}>{list.length}</b> engagement{list.length !== 1 && 's'}. {blurb}</div>
      {list.length ? list.map((e) => {
        const b = model.bucket(e);
        const label = b === 'active' ? model.health(e) : b[0].toUpperCase() + b.slice(1);
        return <ListRow key={e.id} title={e.name} desc={`${e.client} · Lead: ${model.name(e.leadId)}`} right={<Tag className={b === 'active' ? healthClass(label) : b === 'paused' ? 'tag-warn' : 'tag-neutral'}>{label}</Tag>} onClick={() => modal.open(<EngagementModal id={e.id} />)} />;
      }) : <Empty>Nothing in this group right now.</Empty>}
    </ModalFrame>
  );
}

export function TalentListModal({ title, ids }: { title: string; ids: string[] }) {
  const { model } = useWorkspace();
  const modal = useModal();
  const list = ids.map((i) => model.talent(i)).filter((t): t is NonNullable<typeof t> => !!t);
  return (
    <ModalFrame title={title}>
      <div className="small" style={{ color: 'var(--text-dim)', marginBottom: 12 }}><b style={{ color: 'var(--text)' }}>{list.length}</b> talent{list.length !== 1 && 's'} — computed live.</div>
      {list.length ? list.map((t) => <ListRow key={t.id} icon={t.initials} title={t.name} desc={`${t.title} · ${t.department}`} right={<Tag className="tag-neutral">{t.util}%</Tag>} onClick={() => modal.open(<TalentModal id={t.id} />)} />) : <Empty>No one in this group right now.</Empty>}
    </ModalFrame>
  );
}

// ---------------- client ----------------
export function ClientModal({ id }: { id: string }) {
  const { model, canEdit, act } = useWorkspace();
  const modal = useModal();
  const c = model.clients().find((x) => x.id === id);
  const [owner, setOwner] = useState(c?.owner ?? '');
  if (!c) return <ModalFrame title="Client">Not found.</ModalFrame>;
  const active = model.active.filter((e) => e.client === c.name);
  const past = model.engagements.filter((e) => e.client === c.name && (e.historical || e.status === 'closed'));
  const people = model.clientTalents(c.name);
  return (
    <ModalFrame wide title={c.name}>
      <div className="stat-strip">
        <Stat value={c.active} label="Active engagements" />
        <Stat value={c.historical} label="Past engagements" />
        <Stat value={people.length} label="Talents involved" />
      </div>
      <div className="kv">Relationship owner: <b>{c.owner}</b> · {c.industry} · {c.country}</div>
      {canEdit && !c.id.startsWith('derived-') && (
        <div className="row" style={{ marginBottom: 12 }}>
          <select className="inline-input" value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="Unassigned">Unassigned</option>
            {model.talents.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
            {!model.talents.some((t) => t.name === owner) && owner !== 'Unassigned' && <option value={owner}>{owner}</option>}
          </select>
          <button className="btn btn-sm" disabled={owner === c.owner} onClick={() => act(() => api.patch(`/clients/${c.id}`, { owner }), 'Relationship owner updated')}>Set owner</button>
        </div>
      )}
      <div className="sub-label">Active engagements</div>
      {active.length ? active.map((e) => <ListRow key={e.id} title={e.name} desc={`${stageLabel(e.stage)} · Lead: ${model.name(e.leadId)}`} right={<Tag className={healthClass(model.health(e))}>{model.health(e)}</Tag>} onClick={() => modal.open(<EngagementModal id={e.id} />)} />) : <Empty>No active engagements.</Empty>}
      <div className="sub-label">Past engagements</div>
      {past.length ? past.map((e) => <ListRow key={e.id} title={e.name} desc={`${e.scope} · Lead: ${model.name(e.leadId)} · ${fmtDate(e.end, { month: 'short', year: 'numeric' })}`} right={<Tag className="tag-neutral">{e.historical ? '📁 Historical' : '🔒 Closed'}</Tag>} onClick={() => modal.open(<EngagementModal id={e.id} />)} />) : <Empty>None on record.</Empty>}
      <div className="sub-label">Who has worked with {c.name}</div>
      {people.map((p) => <ListRow key={p.id} icon={<Avatar text={model.talentById.get(p.id)?.initials ?? '?'} size={22} />} title={p.name} desc={p.projects.slice(0, 3).join(', ') + (p.projects.length > 3 ? ` +${p.projects.length - 3} more` : '')} right={<Tag className="tag-neutral">{p.projects.length}</Tag>} onClick={() => model.talent(p.id) && modal.open(<TalentModal id={p.id} />)} />)}
    </ModalFrame>
  );
}
