import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { TEMPLATE_FIELDS, buildProjectEmail, parseEmailList } from '../../../shared/notify';
import type { NotificationSettings, Role, User } from '../../../shared/types';
import { Card, PageHead, Tag, fmtDate } from '../components/ui';
import { api } from '../lib/api';
import { useWorkspace } from '../lib/workspace';

export default function Settings() {
  const { user, isAdmin, act, setUser } = useWorkspace();
  const [name, setName] = useState(user.name);
  const [pw, setPw] = useState({ current: '', next: '' });
  return (
    <>
      <PageHead title="Settings" desc="Your profile and password. Admins also manage who can access EEOS." />
      <div className="row-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Card title="Profile">
          <div className="form-grid">
            <div className="form-field full"><label>Name (shown in the audit trail)</label><input value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="form-field"><label>Email</label><input value={user.email} disabled /></div>
            <div className="form-field"><label>Access</label><input value={user.role} disabled /></div>
          </div>
          <button className="btn btn-primary btn-sm" style={{ marginTop: 14 }} disabled={!name.trim() || name === user.name}
            onClick={async () => { if (await act(() => api.patch('/auth/profile', { name }), 'Profile saved')) setUser({ ...user, name }); }}>Save profile</button>
        </Card>
        <Card title="Change password">
          <div className="form-grid">
            <div className="form-field full"><label>Current password</label><input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></div>
            <div className="form-field full"><label>New password (10+ characters)</label><input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></div>
          </div>
          <button className="btn btn-primary btn-sm" style={{ marginTop: 14 }} disabled={!pw.current || pw.next.length < 10}
            onClick={async () => { if (await act(() => api.post('/auth/password', pw), 'Password changed')) setPw({ current: '', next: '' }); }}>Change password</button>
        </Card>
      </div>
      {(isAdmin || user.role === 'editor') && <ProjectEmails />}
      {isAdmin && <Users me={user} />}
    </>
  );
}

function Users({ me }: { me: User }) {
  const { act } = useWorkspace();
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<{ users: User[] }>('/users') });
  const [f, setF] = useState({ name: '', email: '', role: 'editor' as Role, password: '' });
  const run = async (fn: () => Promise<unknown>, msg: string) => { const ok = await act(fn, msg); await qc.invalidateQueries({ queryKey: ['users'] }); return ok; };
  return (
    <Card title="Users & access">
      <div className="small muted" style={{ marginBottom: 10 }}>Viewers can see everything; editors can change engagements, people and capacity; admins also manage users, backups and resets.</div>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Name</th><th>Email</th><th>Access</th><th>Since</th><th>Status</th><th /></tr></thead>
          <tbody>{users.data?.users.map((u) => (
            <tr key={u.id} style={{ cursor: 'default' }}>
              <td><b>{u.name}</b>{u.id === me.id && <span className="muted small"> (you)</span>}</td><td>{u.email}</td>
              <td><select className="inline-input" value={u.role} disabled={u.id === me.id} onChange={(e) => run(() => api.patch(`/users/${u.id}`, { role: e.target.value }), 'Access updated')}>
                <option value="viewer">Viewer</option><option value="editor">Editor</option><option value="admin">Admin</option></select></td>
              <td>{fmtDate(u.createdAt)}</td>
              <td>{u.disabled ? <Tag className="tag-danger">Disabled</Tag> : <Tag className="tag-ok">Active</Tag>}</td>
              <td>{u.id !== me.id && (
                <div className="row" style={{ flexWrap: 'nowrap' }}>
                  <button className="btn btn-sm" onClick={() => run(() => api.patch(`/users/${u.id}`, { disabled: !u.disabled }), u.disabled ? 'User enabled' : 'User disabled')}>{u.disabled ? 'Enable' : 'Disable'}</button>
                  <button className="btn btn-sm" onClick={() => { const p = window.prompt(`New password for ${u.name} (10+ characters):`); if (p) run(() => api.patch(`/users/${u.id}`, { password: p }), 'Password reset — share it securely'); }}>Reset password</button>
                </div>
              )}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div className="sub-label">Invite someone</div>
      <div className="row">
        <input className="inline-input" placeholder="Full name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <input className="inline-input" placeholder="Email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <select className="inline-input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}><option value="viewer">Viewer</option><option value="editor">Editor</option><option value="admin">Admin</option></select>
        <input className="inline-input" placeholder="Temporary password (10+)" type="text" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        <button className="btn btn-primary btn-sm" disabled={!f.name || !f.email || f.password.length < 10}
          onClick={async () => { if (await run(() => api.post('/users', f), `${f.name} can now sign in`)) setF({ name: '', email: '', role: 'editor', password: '' }); }}>Add user</button>
      </div>
    </Card>
  );
}

function ProjectEmails() {
  const { model, isAdmin, act } = useWorkspace();
  const q = useQuery({ queryKey: ['notify-settings'], queryFn: () => api.get<{ settings: NotificationSettings; defaults: NotificationSettings; sender: string | null }>('/settings/notifications') });
  const qc = useQueryClient();
  const [draft, setDraft] = useState<(NotificationSettings & { committeeText: string }) | null>(null);
  if (!q.data) return <Card title="📧 New-project emails"><div className="muted small">Loading…</div></Card>;
  const s = draft ?? { ...q.data.settings, committeeText: q.data.settings.committee.join(', ') };
  const set = (patch: Partial<typeof s>) => setDraft({ ...s, ...patch });
  const committee = parseEmailList(s.committeeText);
  const example = [...model.active].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const preview = example ? buildProjectEmail(example, (id) => model.talentById.get(id), { ...s, committee: committee.valid }) : null;
  const missingEmails = model.talents.filter((t) => !t.email).length;
  const insert = (key: string) => set({ body: s.body + `{{${key}}}` });
  const save = async () => {
    if (await act(() => api.put('/settings/notifications', { enabled: s.enabled, committee: committee.valid, subject: s.subject, body: s.body }), 'Email settings saved')) {
      setDraft(null);
      qc.invalidateQueries({ queryKey: ['notify-settings'] });
    }
  };
  return (
    <Card title="📧 New-project emails" style={{ marginBottom: 16 }}>
      <div className="small" style={{ color: 'var(--text-dim)', lineHeight: 1.6, marginBottom: 12 }}>
        When an engagement is created, this email goes to its leader, members, Operations members and supervisor, with the planning committee in copy.
      </div>
      <div className="box small" style={{ lineHeight: 1.6 }}>
        <b>Sending account:</b> {q.data.sender ? <span style={{ color: 'var(--ok)' }}>✅ {q.data.sender}</span> : <span style={{ color: 'var(--warn)' }}>⚠ Not set up yet — add the Microsoft 365 (MS_…) settings in Vercel — see the README. Engagements are still created; the email just isn't sent.</span>}
        <br /><b>People with an email on file:</b> {model.talents.length - missingEmails} of {model.talents.length}{missingEmails > 0 && <> — add the rest under <b>Data Management → Roster</b>.</>}
      </div>
      <fieldset disabled={!isAdmin} style={{ border: 'none' }}>
        <div className="form-grid">
          <div className="form-field full">
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={s.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> Send automatically when an engagement is created
            </label>
          </div>
          <div className="form-field full">
            <label>Planning committee emails (always in copy) — separate with commas or new lines</label>
            <textarea value={s.committeeText} onChange={(e) => set({ committeeText: e.target.value })} placeholder="planning@theboardconsulting.com, pmo@theboardconsulting.com" style={{ minHeight: 60 }} />
            {committee.invalid.length > 0 && <span className="error-text">Not valid email addresses: {committee.invalid.join(', ')}</span>}
            {committee.valid.length > 0 && <span className="small muted">{committee.valid.length} address{committee.valid.length > 1 && 'es'}</span>}
          </div>
          <div className="form-field full"><label>Subject</label><input value={s.subject} onChange={(e) => set({ subject: e.target.value })} /></div>
          <div className="form-field full">
            <label>Message — the {'{{fields}}'} fill in automatically</label>
            <textarea value={s.body} onChange={(e) => set({ body: e.target.value })} style={{ minHeight: 220, fontFamily: 'inherit', lineHeight: 1.5 }} />
            {isAdmin && <div className="row" style={{ gap: 5, marginTop: 6 }}>
              <span className="small muted">Insert:</span>
              {TEMPLATE_FIELDS.map((f) => <button key={f.key} type="button" className="tab" style={{ fontSize: 10.5, padding: '3px 8px' }} title={f.label} onClick={() => insert(f.key)}>{f.key}</button>)}
            </div>}
          </div>
        </div>
      </fieldset>
      {preview && (
        <>
          <div className="sub-label">Preview — using “{example.name}”</div>
          <div className="box" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
            <div><b>To:</b> {preview.to.join(', ') || <span className="muted">nobody yet (no emails on file)</span>}</div>
            <div><b>Cc:</b> {preview.cc.join(', ') || <span className="muted">—</span>}</div>
            {preview.missing.length > 0 && <div style={{ color: 'var(--warn)' }}>No email on file for: {preview.missing.join(', ')}</div>}
            <div><b>Subject:</b> {preview.subject}</div>
            <div style={{ whiteSpace: 'pre-wrap', marginTop: 8, borderTop: '1px solid var(--border-soft)', paddingTop: 8 }}>{preview.body}</div>
          </div>
        </>
      )}
      {isAdmin && (
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn btn-primary btn-sm" disabled={!draft || committee.invalid.length > 0} onClick={save}>Save email settings</button>
          {draft && <button className="btn btn-ghost btn-sm" onClick={() => setDraft(null)}>Discard changes</button>}
          <button className="btn btn-ghost btn-sm" onClick={() => set({ subject: q.data!.defaults.subject, body: q.data!.defaults.body })}>Restore original template</button>
          <span className="spacer" />
          <button className="btn btn-sm" disabled={!q.data.sender} title={q.data.sender ? '' : 'Set up the sending account first'}
            onClick={() => act(() => api.post('/settings/notifications/test', { engagementId: example?.id }), 'Test email sent to you — check your inbox')}>Send a test to me (saved settings)</button>
        </div>
      )}
    </Card>
  );
}
