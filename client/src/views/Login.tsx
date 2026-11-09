import { useState } from 'react';
import type { User } from '../../../shared/types';
import { api } from '../lib/api';

export function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api.post<{ user: User }>('/auth/login', { email, password });
      onLogin(r.user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login-wrap">
      <form className="card login-card" onSubmit={submit}>
        <div className="brand-mark"><img src="/tbc-mark.png" alt="TBC" /></div>
        <div className="section-title">Engagement Excellence OS</div>
        <div className="section-desc">The Board Consulting · sign in to your workspace</div>
        <div className="form-field" style={{ marginBottom: 12 }}><label htmlFor="email">Email</label><input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></div>
        <div className="form-field"><label htmlFor="pw">Password</label><input id="pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
        {error && <div className="error-text">{error}</div>}
        <button className="btn btn-primary" style={{ marginTop: 16, width: '100%', justifyContent: 'center' }} disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <div className="small muted" style={{ marginTop: 12 }}>No account? Ask an EEOS admin to invite you.</div>
      </form>
    </div>
  );
}
