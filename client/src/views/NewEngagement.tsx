import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SCOPES, SCOPE_STAGES, SECTORS, SUB_SCOPES_STRATEGY, WORKLOAD_TIERS, WORKLOAD_TIER_NAMES, type Scope } from '../../../shared/constants';
import { parseCpsCsv, parseDay, scopeStages, toDay } from '../../../shared/schedule';
import { buildProjectEmail } from '../../../shared/notify';
import type { CpsStage, NotificationSettings } from '../../../shared/types';
import { CpsBar } from '../components/charts';
import { EmailTeamModal, TeamPicker } from '../components/modals';
import { Card, PageHead, useModal, useToast } from '../components/ui';
import { api } from '../lib/api';
import { useWorkspace } from '../lib/workspace';

export default function NewEngagement() {
  const { model, canEdit, act } = useWorkspace();
  const toast = useToast();
  const modal = useModal();
  const notifyQ = useQuery({ queryKey: ['notify-settings'], queryFn: () => api.get<{ settings: NotificationSettings; sender: string | null }>('/settings/notifications'), enabled: canEdit });
  const [notify, setNotify] = useState(true);
  const nav = useNavigate();
  const staffable = model.talents.filter((t) => t.department !== 'Operations');
  const today = toDay(model.now);
  const blank = () => ({
    name: '', client: '', country: 'Egypt', sector: '', scope: 'Research' as Scope, subScope: '', workloadTier: 'Quick Work',
    price: '', cost: '', start: today, end: '', stage: 'kickoff', notes: '',
  });
  const [f, setF] = useState(blank);
  const [team, setTeam] = useState({ leadId: staffable[0]?.id ?? '', teamIds: staffable[0] ? [staffable[0].id] : [], supervisorId: null as string | null });
  const [cps, setCps] = useState<CpsStage[] | null>(null);
  const [cpsMsg, setCpsMsg] = useState('');
  const set = (k: keyof ReturnType<typeof blank>) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const stages = scopeStages(f.scope);
  const recs = useMemo(() => model.recommendations(f.sector, f.scope, 5), [model, f.sector, f.scope]);
  const datesOk = !!f.start && (!f.end || parseDay(f.end) > parseDay(f.start));
  const strat = f.scope === 'Strategy' || f.scope === 'Research and Strategy';

  const changeScope = (scope: Scope) => {
    setF({ ...f, scope, stage: scopeStages(scope)[0].id });
    setCps(null);
    setCpsMsg('');
  };
  const onCps = async (file: File) => {
    const { parsed, unmatched } = parseCpsCsv(await file.text(), f.scope, f.start);
    setCps(parsed.length ? parsed : null);
    setCpsMsg(parsed.length ? `✅ Loaded ${parsed.length} stages${unmatched.length ? ` — skipped ${unmatched.join(', ')}` : ''}.` : '⚠ No rows matched this scope’s stage names.');
  };
  type EmailResult = { sent: boolean; manual?: boolean; skipped?: string; error?: string; to: string[]; cc: string[]; missing: string[] } | null;
  const submit = async () => {
    const box: { email: EmailResult; id?: string } = { email: null };
    const ok = await act(async () => {
      const r = await api.post<{ email: EmailResult; engagement: { id: string } }>('/engagements', {
        ...f, ...team, end: f.end || null, subScope: strat ? f.subScope || null : null, price: f.price === '' ? null : Number(f.price), cost: f.cost === '' ? null : Number(f.cost), customCps: cps, notify,
      });
      box.email = r.email;
      box.id = r.engagement.id;
    });
    if (!ok) return;
    const e = box.email;
    if (!e) toast(`Engagement “${f.name}” created`);
    else if (e.manual) {
      // One-click mode: hand the ready-made email to the person creating the engagement.
      nav('/engagements/status');
      modal.open(<EmailTeamModal id={box.id!} justCreated />);
      return;
    }
    else if (e.sent) toast(`Engagement “${f.name}” created · email sent to ${e.to.length + e.cc.length} people${e.missing.length ? ` (no email on file for ${e.missing.join(', ')})` : ''}`);
    else toast(`Engagement “${f.name}” created, but the email was not sent: ${e.error ?? e.skipped}`, 'error');
    nav('/engagements/status');
  };
  const settings = notifyQ.data?.settings;
  const emailPreview = settings && team.leadId ? buildProjectEmail(
    { name: f.name || '(project name)', client: f.client || '(client)', sector: f.sector, scope: f.scope, start: f.start, end: f.end || null, ...team },
    (id) => model.talentById.get(id), settings) : null;

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
          <div className="form-field"><label>Planned end date (optional)</label><input type="date" value={f.end} onChange={set('end')} />
            <span className="small muted">Leave empty if not agreed — no end date is ever assumed.</span></div>
          <div className="form-field"><label>Initial stage</label><select value={f.stage} onChange={set('stage')}>{stages.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></div>
          <div className="form-field"><label>Selling price (optional)</label><input type="number" min={0} value={f.price} onChange={set('price')} /></div>
          <div className="form-field"><label>Cost (optional)</label><input type="number" min={0} value={f.cost} onChange={set('cost')} /></div>

          <div className="form-field full">
            <label>📅 Critical path schedule (CPS)</label>
            <div className="row small muted" style={{ marginBottom: 8 }}>
              <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && onCps(e.target.files[0])} />
              Upload the weekly plan (CSV: Activity, Start Week, End Week, Owner) — weeks count from the start date. Without it, no stage dates are set.
              {cps && <button type="button" className="btn btn-danger-outline btn-sm" onClick={() => { setCps(null); setCpsMsg(''); }}>Remove</button>}
            </div>
            {cpsMsg && <div className="small" style={{ marginBottom: 8 }}>{cpsMsg}</div>}
            <div className="card" style={{ background: 'var(--panel-2)', padding: '12px 14px' }}>
              {!datesOk ? <div className="empty-state" style={{ padding: 14, color: 'var(--danger)' }}>{f.start ? 'The end date must be after the start date.' : 'Set a start date first.'}</div>
                : <CpsBar model={model} e={{ start: f.start, end: f.end || null, scope: f.scope, stage: f.stage as never, customCps: cps }} />}
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
        {emailPreview && (
          <div className="box" style={{ marginTop: 16, fontSize: 12, lineHeight: 1.6 }}>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', fontWeight: 600, color: 'var(--text)' }}>
              <input type="checkbox" checked={notify && settings!.enabled} disabled={!settings!.enabled} onChange={(e) => setNotify(e.target.checked)} />
              📧 Email the team and planning committee when I create this
            </label>
            {!settings!.enabled ? <div className="muted">New-project emails are turned off in Settings.</div> : notify && (
              <>
                <div><b>To:</b> {emailPreview.to.join(', ') || <span className="muted">nobody on this team has an email on file</span>}</div>
                <div><b>Cc (planning committee):</b> {emailPreview.cc.join(', ') || <span className="muted">none set — add it in Settings</span>}</div>
                {emailPreview.missing.length > 0 && <div style={{ color: 'var(--warn)' }}>No email on file for {emailPreview.missing.join(', ')} — add it under Data Management → Roster.</div>}
                {!notifyQ.data?.sender && <div className="muted">After you click <b>Create engagement</b>, the email opens ready-made in Outlook — you just press <b>Send</b>.</div>}
              </>
            )}
          </div>
        )}
        <div className="row" style={{ marginTop: 18 }}>
          <button className="btn btn-primary" disabled={!f.name.trim() || !f.client.trim() || !f.sector.trim() || !datesOk || !team.leadId} onClick={submit}>＋ Create engagement</button>
          <button className="btn btn-ghost" onClick={() => { setF(blank()); setCps(null); setCpsMsg(''); }}>Clear form</button>
        </div>
      </Card>
    </>
  );
}
