import { useEffect, useState } from 'react';
import type { User } from '../../../shared/types';
import { api } from '../lib/api';

export function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [setup, setSetup] = useState<string | null>(null);
  // If the server isn't set up yet (no database or no admin account), say so up front.
  useEffect(() => {
    fetch('/api/health').then(async (r) => {
      if (!r.ok) setSetup((await r.json().catch(() => ({}))).error ?? 'The server is not set up yet.');
    }).catch(() => setSetup('Cannot reach the EEOS server.'));
  }, []);
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
        {setup && (
          <div className="viewer-banner" style={{ lineHeight: 1.6 }}>
            <b>EEOS isn't set up yet.</b> {setup}
            <div style={{ fontWeight: 400, marginTop: 6 }}>
              The first account is the email and password you set as <code>ADMIN_EMAIL</code> and <code>ADMIN_PASSWORD</code> in your hosting settings
              (on Vercel: Project → Settings → Environment Variables), then redeploy.
            </div>
          </div>
        )}
        <div className="form-field" style={{ marginBottom: 12 }}><label htmlFor="email">Email</label><input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></div>
        <div className="form-field"><label htmlFor="pw">Password</label><input id="pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
        {error && <div className="error-text">{error}</div>}
        <button className="btn btn-primary" style={{ marginTop: 16, width: '100%', justifyContent: 'center' }} disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <div className="small muted" style={{ marginTop: 12, lineHeight: 1.5 }}>No account? Ask an EEOS admin to invite you. The very first admin signs in with the <code>ADMIN_EMAIL</code> / <code>ADMIN_PASSWORD</code> set when EEOS was deployed.</div>
      </form>
    </div>
  );
}
