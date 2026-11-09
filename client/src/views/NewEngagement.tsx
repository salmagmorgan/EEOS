import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SCOPES, SCOPE_STAGES, SECTORS, SUB_SCOPES_STRATEGY, WORKLOAD_TIERS, WORKLOAD_TIER_NAMES, type Scope } from '../../../shared/constants';
import { addDays, parseCpsCsv, parseDay, scopeStages, toDay } from '../../../shared/schedule';
import type { CpsStage } from '../../../shared/types';
import { CpsBar } from '../components/charts';
import { TeamPicker } from '../components/modals';
import { Card, PageHead } from '../components/ui';
import { api } from '../lib/api';
import { useWorkspace } from '../lib/workspace';

export default function NewEngagement() {
  const { model, canEdit, act } = useWorkspace();
  const nav = useNavigate();
  const staffable = model.talents.filter((t) => t.department !== 'Operations');
  const today = toDay(model.now);
  const blank = () => ({
    name: '', client: '', country: 'Egypt', sector: '', scope: 'Research' as Scope, subScope: '', workloadTier: 'Quick Work',
    price: '', cost: '', start: today, end: toDay(addDays(model.now, SCOPE_STAGES.Research.typicalDays)), stage: 'kickoff', notes: '',
  });
  const [f, setF] = useState(blank);
  const [team, setTeam] = useState({ leadId: staffable[0]?.id ?? '', teamIds: staffable[0] ? [staffable[0].id] : [], supervisorId: null as string | null });
  const [cps, setCps] = useState<CpsStage[] | null>(null);
  const [cpsMsg, setCpsMsg] = useState('');
  const set = (k: keyof ReturnType<typeof blank>) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const stages = scopeStages(f.scope);
  const recs = useMemo(() => model.recommendations(f.sector, f.scope, 5), [model, f.sector, f.scope]);
  const datesOk = f.start && f.end && parseDay(f.end) > parseDay(f.start);
  const strat = f.scope === 'Strategy' || f.scope === 'Research and Strategy';

  const changeScope = (scope: Scope) => {
    setF({ ...f, scope, stage: scopeStages(scope)[0].id, end: toDay(addDays(parseDay(f.start || today), SCOPE_STAGES[scope].typicalDays)) });
    setCps(null);
    setCpsMsg('');
  };
  const onCps = async (file: File) => {
    const { parsed, unmatched } = parseCpsCsv(await file.text(), f.scope, f.start);
    setCps(parsed.length ? parsed : null);
    setCpsMsg(parsed.length ? `✅ Loaded ${parsed.length} stages${unmatched.length ? ` — skipped ${unmatched.join(', ')}` : ''}.` : '⚠ No rows matched this scope’s stage names.');
  };
  const submit = async () => {
    const ok = await act(() => api.post('/engagements', {
      ...f, ...team, subScope: strat ? f.subScope || null : null, price: f.price === '' ? null : Number(f.price), cost: f.cost === '' ? null : Number(f.cost), customCps: cps,
    }), `Engagement “${f.name}” created`);
    if (ok) nav('/engagements/status');
  };

  if (!canEdit) return <PageHead title="New Engagement" desc="You have view-only access, so you can't create engagements." />;
  return (
    <>
      <PageHead title="New Engagement" desc="Create a consulting engagement and staff it. Recommendations and rotation warnings update as you go." />
      <Card>
        <div className="form-grid">
          <div className="form-field full"><label>Engagement name *</label><input value={f.name} onChange={set('name')} placeholder="e.g. Brand Repositioning Strategy" /></div>
          <div className="form-field"><label>Client *</label><input list="clients" value={f.client} onChange={set('client')} placeholder="Existing or new client" /><datalist id="clients">{model.clients().map((c) => <option key={c.id} value={c.name} />)}</datalist></div>
          <div className="form-field"><label>Country</label><input value={f.country} onChange={set('country')} /></div>
          <div className="form-field"><label>Sector *</label><input list="sectors" value={f.sector} onChange={set('sector')} placeholder="Choose or type a sector" /><datalist id="sectors">{SECTORS.map((s) => <option key={s} value={s} />)}</datalist></div>
          <div className="form-field"><label>Scope</label><select value={f.scope} onChange={(e) => changeScope(e.target.value as Scope)}>{SCOPES.map((s) => <option key={s}>{s}</option>)}</select>
            <div className="small" style={{ color: 'var(--lavender)' }}>{SCOPE_STAGES[f.scope].icon} Runs {stages[0].label} → {stages[stages.length - 1].label}</div></div>
          {strat && <div className="form-field"><label>Strategy sub-type</label><input list="subscopes" value={f.subScope} onChange={set('subScope')} /><datalist id="subscopes">{SUB_SCOPES_STRATEGY.map((s) => <option key={s} value={s} />)}</datalist></div>}
          <div className="form-field"><label>Project intensity</label><select value={f.workloadTier} onChange={set('workloadTier')}>{WORKLOAD_TIER_NAMES.map((t) => <option key={t} value={t}>{WORKLOAD_TIERS[t].icon} {t}</option>)}</select></div>
          <div className="form-field"><label>Start date</label><input type="date" value={f.start} onChange={set('start')} /></div>
          <div className="form-field"><label>End date</label><input type="date" value={f.end} onChange={set('end')} /></div>
          <div className="form-field"><label>Initial stage</label><select value={f.stage} onChange={set('stage')}>{stages.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></div>
          <div className="form-field"><label>Selling price (optional)</label><input type="number" min={0} value={f.price} onChange={set('price')} /></div>
          <div className="form-field"><label>Cost (optional)</label><input type="number" min={0} value={f.cost} onChange={set('cost')} /></div>

          <div className="form-field full">
            <label>📅 Critical path schedule</label>
            <div className="row small muted" style={{ marginBottom: 8 }}>
              <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && onCps(e.target.files[0])} />
              Optional weekly plan (CSV: Activity, Start Week, End Week, Owner) — weeks count from the start date.
              {cps && <button type="button" className="btn btn-danger-outline btn-sm" onClick={() => { setCps(null); setCpsMsg(''); }}>Remove</button>}
            </div>
            {cpsMsg && <div className="small" style={{ marginBottom: 8 }}>{cpsMsg}</div>}
            <div className="card" style={{ background: 'var(--panel-2)', padding: '12px 14px' }}>
              {datesOk ? <CpsBar model={model} e={{ start: f.start, end: f.end, scope: f.scope, stage: f.stage as never, customCps: cps }} /> : <div className="empty-state" style={{ padding: 14, color: 'var(--danger)' }}>The end date must be after the start date.</div>}
            </div>
          </div>

          <div className="form-field full">
            <label>🎯 Recommended team (30% capacity · 25% fair rotation · 25% scope experience · 20% sector experience)</label>
            <div className="card" style={{ background: 'var(--panel-2)', padding: '12px 14px' }}>
              {recs.map((r) => (
                <div key={r.talent.id} className="talent-rec">
                  <div className="avatar" style={{ width: 34, height: 34, fontSize: 11 }}>{r.talent.initials}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="trec-name">{r.talent.name} <span className="muted" style={{ fontWeight: 400, fontSize: 10.5 }}>— {r.talent.title}</span></div>
                    <div className="trec-role">{r.reason}</div>
                    <div className="row" style={{ marginTop: 4, gap: 5 }}>{Object.entries(r.breakdown).map(([k, v]) => <span key={k} className="mini-pill">{k} {v}</span>)}</div>
                  </div>
                  <div className="trec-fit"><div className="fv" style={{ color: r.fit >= 80 ? 'var(--ok)' : r.fit >= 60 ? 'var(--warn)' : 'var(--danger)' }}>{r.fit}%</div><div className="fl">Fit</div></div>
                  <button type="button" className="btn btn-sm btn-primary" disabled={team.teamIds.includes(r.talent.id)}
                    onClick={() => setTeam({ ...team, teamIds: [...team.teamIds, r.talent.id], supervisorId: team.supervisorId === r.talent.id ? null : team.supervisorId })}>+ Add</button>
                </div>
              ))}
            </div>
          </div>
          <div className="form-field full"><TeamPicker model={model} {...team} onChange={setTeam} /></div>
          <div className="form-field full"><label>Notes</label><textarea value={f.notes} onChange={set('notes')} placeholder="Context, objectives, background…" /></div>
        </div>
        <div className="row" style={{ marginTop: 18 }}>
          <button className="btn btn-primary" disabled={!f.name.trim() || !f.client.trim() || !f.sector.trim() || !datesOk || !team.leadId} onClick={submit}>＋ Create engagement</button>
          <button className="btn btn-ghost" onClick={() => { setF(blank()); setCps(null); setCpsMsg(''); }}>Clear form</button>
        </div>
      </Card>
    </>
  );
}
