import TpLogo from './TpLogo';

export default function LoginChooser({ onShowView, onClose }) {
  return (
    <div className="view active" id="view-chooser" style={{ position: 'fixed', inset: 0, zIndex: 8000, background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      <div className="chooser-bg" />
      <div className="chooser-glow" />
      <div className="chooser-inner">
        <div className="chooser-logo">
          <div className="lbox" style={{ width: 38, height: 38, borderRadius: 9, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <TpLogo size={38} />
          </div>
          Trucker<span style={{ color: 'var(--amber)' }}>Path</span>
        </div>
        <div className="chooser-subtitle">Sign in to your account or create a new one</div>
        <div className="chooser-cards">
          <div className="chooser-card" onClick={() => onShowView('admin-login')}>
            <div className="chooser-card-icon" style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.22)' }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--amber)" strokeWidth="1.8"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
            </div>
            <div className="chooser-card-title">Fleet Admin</div>
            <div className="chooser-card-desc">Manage dispatch, drivers, billing and full fleet operations</div>
            <button className="chooser-card-btn">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3"/></svg>
              Sign In as Admin
            </button>
          </div>
          <div className="chooser-card" onClick={() => onShowView('user-login')}>
            <div className="chooser-card-icon" style={{ background: 'rgba(28,142,232,0.1)', border: '1px solid rgba(28,142,232,0.22)' }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--blue-brand)" strokeWidth="1.8"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            </div>
            <div className="chooser-card-title">Customer Portal</div>
            <div className="chooser-card-desc">Book shipments, track freight and manage your account</div>
            <button className="chooser-card-btn">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3"/></svg>
              Sign In as Customer
            </button>
          </div>
        </div>
        <div className="chooser-back" onClick={onClose}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
          Back to Qubiway
        </div>
      </div>
    </div>
  );
}
