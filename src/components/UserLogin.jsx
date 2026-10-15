import { useState } from 'react';
import TpLogo from './TpLogo';

const DEMO_LOGIN = { email: 'user@company.com', password: 'user123' };

function LoginForm({ onLogin, onBack, onShowView, onSwitchToSignup }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async e => {
    e.preventDefault();
    setError('');
    setLoading(true);
    await new Promise(r => setTimeout(r, 900));
    if (email === DEMO_LOGIN.email && password === DEMO_LOGIN.password) {
      onLogin('user');
    } else {
      setError('Invalid credentials. Use the demo credentials above.');
    }
    setLoading(false);
  };

  const fillDemo = () => { setEmail(DEMO_LOGIN.email); setPassword(DEMO_LOGIN.password); setError(''); };

  return (
    <div className="login-view" style={{ position: 'fixed', inset: 0, zIndex: 8000, display: 'grid', gridTemplateColumns: '1fr 1fr', background: 'var(--bg)', overflow: 'hidden' }}>
      {/* LEFT */}
      <div className="login-left">
        <div className="login-left-bg" style={{ background: 'linear-gradient(135deg,#060A18 0%,#091428 60%,#05080F 100%)' }} />
        <div className="login-left-grid" style={{ backgroundImage: 'linear-gradient(rgba(59,130,246,0.05) 1px,transparent 1px),linear-gradient(90deg,rgba(59,130,246,0.05) 1px,transparent 1px)' }} />
        <div className="login-left-glow" style={{ background: 'radial-gradient(circle,rgba(59,130,246,0.12) 0%,transparent 70%)' }} />
        <div className="login-left-content">
          <div className="login-left-logo">
            <div style={{ width: 34, height: 34, borderRadius: 8, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <TpLogo size={34} />
            </div>
            Qubiway
          </div>
          <div className="login-role-badge" style={{ background: 'rgba(59,130,246,0.12)', borderColor: 'rgba(59,130,246,0.28)', color: '#60A5FA' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            Customer Portal
          </div>
          <div className="login-left-title">
            Ship Smarter.<br />
            <span style={{ color: '#60A5FA' }}>Track Faster.</span>
          </div>
          <div className="login-left-sub">
            Book shipments in minutes, get real-time tracking, and manage all your freight from one simple dashboard.
          </div>
          <div className="login-feat-list">
            {[
              'Book FTL, LTL, Reefer & Expedited loads',
              'Real-time GPS tracking with driver updates',
              'Instant price estimates before you book',
              'Digital proof of delivery & invoice history',
            ].map((f, i) => (
              <div key={i} className="login-feat">
                <div className="login-feat-dot" style={{ background: '#3B82F6' }} />
                {f}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* RIGHT */}
      <div className="login-right">
        <div className="login-form-box">
          <div className="login-form-title">Customer Login</div>
          <div className="login-form-sub">Sign in to your shipping account.</div>
          <div className="lf-demo-creds" style={{ background: 'rgba(59,130,246,0.08)', borderColor: 'rgba(59,130,246,0.25)', marginBottom: 20 }}>
            <strong style={{ color: '#60A5FA' }}>Demo credentials:</strong><br />
            Email: <strong style={{ color: '#60A5FA' }}>{DEMO_LOGIN.email}</strong><br />
            Password: <strong style={{ color: '#60A5FA' }}>{DEMO_LOGIN.password}</strong>
            <button type="button" onClick={fillDemo} style={{ display: 'block', marginTop: 8, background: 'none', border: 'none', color: '#60A5FA', fontSize: 12, cursor: 'pointer', padding: 0, fontFamily: 'inherit', fontWeight: 600 }}>
              → Click to fill automatically
            </button>
          </div>
          <form onSubmit={submit}>
            <div className="lf-group">
              <label className="lf-label">Email Address</label>
              <input className="lf-input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" required />
            </div>
            <div className="lf-group">
              <label className="lf-label">Password</label>
              <input className="lf-input" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter your password" required />
            </div>
            {error && <div className="lf-error show">{error}</div>}
            <button className="lf-submit" type="submit" disabled={loading} style={{ background: '#1C8EE8', marginTop: 8 }}>
              {loading
                ? <><span style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite', display: 'inline-block' }} />Signing in…</>
                : <>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3"/></svg>
                    Sign in to Customer Portal
                  </>
              }
            </button>
          </form>
          <div className="lf-divider">or</div>
          <button
            className="lf-submit"
            style={{ background: 'var(--surface)', border: '1px solid var(--border2)', color: 'var(--text)', fontWeight: 500 }}
            onClick={onSwitchToSignup}
          >
            Create a new account →
          </button>
          <div className="lf-back" onClick={onBack}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
            Back to account selection
          </div>
        </div>
      </div>
    </div>
  );
}

function SignupForm({ onLogin, onBack }) {
  const [form, setForm] = useState({ name: '', company: '', email: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async e => {
    e.preventDefault();
    if (form.password !== form.confirm) { setError('Passwords do not match.'); return; }
    setError('');
    setLoading(true);
    await new Promise(r => setTimeout(r, 900));
    onLogin('user');
    setLoading(false);
  };

  return (
    <div className="login-view" style={{ position: 'fixed', inset: 0, zIndex: 8000, display: 'grid', gridTemplateColumns: '1fr 1fr', background: 'var(--bg)', overflow: 'hidden' }}>
      {/* LEFT */}
      <div className="login-left">
        <div className="login-left-bg" style={{ background: 'linear-gradient(135deg,#060A18 0%,#091428 60%,#05080F 100%)' }} />
        <div className="login-left-grid" style={{ backgroundImage: 'linear-gradient(rgba(59,130,246,0.05) 1px,transparent 1px),linear-gradient(90deg,rgba(59,130,246,0.05) 1px,transparent 1px)' }} />
        <div className="login-left-glow" style={{ background: 'radial-gradient(circle,rgba(59,130,246,0.12) 0%,transparent 70%)' }} />
        <div className="login-left-content">
          <div className="login-left-logo">
            <div style={{ width: 34, height: 34, borderRadius: 8, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <TpLogo size={34} />
            </div>
            Qubiway
          </div>
          <div className="login-role-badge" style={{ background: 'rgba(59,130,246,0.12)', borderColor: 'rgba(59,130,246,0.28)', color: '#60A5FA' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
            Get Started Free
          </div>
          <div className="login-left-title">
            Join 11 Million<br />
            <span style={{ color: '#60A5FA' }}>Truckers &amp; Shippers</span>
          </div>
          <div className="login-left-sub">
            Create your free account and start booking shipments today. No credit card required.
          </div>
          <div className="login-feat-list">
            {[
              'Free to sign up — no credit card needed',
              'Access 150,000+ loads daily on the load board',
              'Real-time tracking & automated updates',
              'Manage invoices and docs in one place',
            ].map((f, i) => (
              <div key={i} className="login-feat">
                <div className="login-feat-dot" style={{ background: '#3B82F6' }} />
                {f}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* RIGHT */}
      <div className="login-right">
        <div className="login-form-box">
          <div className="login-form-title">Create Account</div>
          <div className="login-form-sub">Start shipping with Qubiway today.</div>
          <form onSubmit={submit} style={{ marginTop: 24 }}>
            <div className="lf-group">
              <label className="lf-label">Full Name</label>
              <input className="lf-input" type="text" value={form.name} onChange={e => set('name', e.target.value)} placeholder="Your name" required />
            </div>
            <div className="lf-group">
              <label className="lf-label">Company</label>
              <input className="lf-input" type="text" value={form.company} onChange={e => set('company', e.target.value)} placeholder="Your company" required />
            </div>
            <div className="lf-group">
              <label className="lf-label">Email Address</label>
              <input className="lf-input" type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="you@company.com" required />
            </div>
            <div className="lf-group">
              <label className="lf-label">Password</label>
              <input className="lf-input" type="password" value={form.password} onChange={e => set('password', e.target.value)} placeholder="Create a password" required />
            </div>
            <div className="lf-group">
              <label className="lf-label">Confirm Password</label>
              <input className="lf-input" type="password" value={form.confirm} onChange={e => set('confirm', e.target.value)} placeholder="Repeat your password" required />
            </div>
            {error && <div className="lf-error show">{error}</div>}
            <button className="lf-submit" type="submit" disabled={loading} style={{ background: '#1C8EE8', marginTop: 8 }}>
              {loading
                ? <><span style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite', display: 'inline-block' }} />Creating account…</>
                : 'Create Free Account →'
              }
            </button>
          </form>
          <div className="lf-back" onClick={onBack}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
            Already have an account? Sign in
          </div>
        </div>
      </div>
    </div>
  );
}

export default function UserLogin({ mode, onLogin, onBack, onShowView }) {
  const [localMode, setLocalMode] = useState(mode);

  if (localMode === 'signup') {
    return <SignupForm onLogin={onLogin} onBack={() => setLocalMode('login')} />;
  }
  return (
    <LoginForm
      onLogin={onLogin}
      onBack={onBack}
      onShowView={onShowView}
      onSwitchToSignup={() => setLocalMode('signup')}
    />
  );
}
