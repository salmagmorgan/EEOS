import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { Role, User } from '../../../shared/types';
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
