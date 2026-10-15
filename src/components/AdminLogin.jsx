import { useState } from 'react';
import TpLogo from './TpLogo';

const DEMO = { email: 'admin@truckerpath.com', password: 'admin123' };

export default function AdminLogin({ onLogin, onBack, onShowView }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async e => {
    e.preventDefault();
    setError('');
    setLoading(true);
    await new Promise(r => setTimeout(r, 900));
    if (email === DEMO.email && password === DEMO.password) {
      onLogin('admin');
    } else {
      setError('Invalid credentials. Use the demo credentials below.');
    }
    setLoading(false);
  };

  const fillDemo = () => { setEmail(DEMO.email); setPassword(DEMO.password); setError(''); };

  return (
    <div className="login-view" style={{ position: 'fixed', inset: 0, zIndex: 8000, display: 'grid', gridTemplateColumns: '1fr 1fr', background: 'var(--bg)', overflow: 'hidden' }}>
      {/* LEFT */}
      <div className="login-left">
        <div className="login-left-bg" />
        <div className="login-left-grid" />
        <div className="login-left-glow" />
        <div className="login-left-content">
          <div className="login-left-logo">
            <div style={{ width: 34, height: 34, borderRadius: 8, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <TpLogo size={34} />
            </div>
            Qubiway
          </div>
          <div className="login-role-badge">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
            Fleet Admin
          </div>
          <div className="login-left-title">
            Fleet <span className="hi">Command</span><br />Center
          </div>
          <p className="login-left-sub">Full operational control. Dispatch, drivers, billing, analytics — all in one command center.</p>
          <div className="login-feat-list">
            {[
              'Live fleet telemetry & AI dispatch',
              'Revenue & cost intelligence dashboards',
              'Real-time alerts & compliance monitoring',
              'OCR billing pipeline & invoice automation',
            ].map((f, i) => (
              <div key={i} className="login-feat">
                <div className="login-feat-dot" />
                {f}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* RIGHT */}
      <div className="login-right">
        <div className="login-form-box">
          <div className="login-form-title">Admin Sign In</div>
          <div className="login-form-sub">Access your fleet operations dashboard</div>
          <div className="lf-demo-creds" style={{ marginBottom: 20 }}>
            <strong style={{ color: 'var(--amber)' }}>Demo credentials:</strong><br />
            Email: <strong style={{ color: 'var(--amber)' }}>{DEMO.email}</strong><br />
            Password: <strong style={{ color: 'var(--amber)' }}>{DEMO.password}</strong>
            <button type="button" onClick={fillDemo} style={{ display: 'block', marginTop: 8, background: 'none', border: 'none', color: 'var(--amber)', fontSize: 12, cursor: 'pointer', padding: 0, fontFamily: 'inherit', fontWeight: 600 }}>
              → Click to fill automatically
            </button>
          </div>
          <form onSubmit={submit}>
            <div className="lf-group">
              <label className="lf-label">Email address</label>
              <input className="lf-input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="admin@truckerpath.com" autoComplete="email" required />
            </div>
            <div className="lf-group">
              <label className="lf-label">Password</label>
              <input className="lf-input" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password" required />
            </div>
            {error && <div className="lf-error show">{error}</div>}
            <button className="lf-submit" type="submit" disabled={loading} style={{ marginTop: 8 }}>
              {loading
                ? <><span style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite', display: 'inline-block' }} />Signing in…</>
                : <>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3"/></svg>
                    Sign In to Admin Console
                  </>
              }
            </button>
          </form>
          <div className="lf-divider">or</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
            <span>Not an admin? <button style={{ background: 'none', border: 'none', color: 'var(--blue-brand)', cursor: 'pointer', fontSize: 'inherit', fontFamily: 'inherit', fontWeight: 600 }} onClick={() => onShowView('user-login')}>Customer login →</button></span>
          </div>
          <div className="lf-back" onClick={onBack}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
            Back to login chooser
          </div>
        </div>
      </div>
    </div>
  );
}
