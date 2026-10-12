import { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import Landing from './pages/Landing';
import LoginChooser from './components/LoginChooser';
import AdminLogin from './components/AdminLogin';
import UserLogin from './components/UserLogin';
import UserDashboard from './pages/UserDashboard';
import Sidebar from './components/Sidebar';
import NotificationPanel from './components/NotificationPanel';
import DispatchBoard from './pages/DispatchBoard';
import FleetTwin from './pages/FleetTwin';
import AlertsFeed from './pages/AlertsFeed';
import BillingPipeline from './pages/BillingPipeline';
import DriverProfile from './pages/DriverProfile';
import CostIntelligence from './pages/CostIntelligence';
import Drivers from './pages/Drivers';
import TpLogo from './components/TpLogo';
import LoadMarketplace from './pages/LoadMarketplace';
import Companies from './pages/Companies';
import CompanyProfile from './pages/CompanyProfile';
import AgentActivity from './pages/AgentActivity';

export default function App() {
  const [view, setView] = useState(() => sessionStorage.getItem('tp-view') ?? 'landing');
  const navigate = useNavigate();
  const location = useLocation();
  const showView = v => setView(v);
  const handleLogin = role => setView(role === 'admin' ? 'admin-dash' : 'user-dash');
  const handleLogout = () => { setView('landing'); navigate('/', { replace: true }); };

  useEffect(() => {
    sessionStorage.setItem('tp-view', view);
  }, [view]);

  useEffect(() => {
    // On login land on /dispatch; on refresh keep the current admin sub-page
    if (view === 'admin-dash' && location.pathname === '/') navigate('/dispatch', { replace: true });
  }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {/* LANDING */}
      {view === 'landing' && <Landing onShowView={showView} />}

      {/* CHOOSER OVERLAY */}
      {view === 'chooser' && (
        <>
          <Landing onShowView={showView} />
          <LoginChooser onShowView={showView} onClose={() => setView('landing')} />
        </>
      )}

      {/* ADMIN LOGIN */}
      {view === 'admin-login' && (
        <AdminLogin onLogin={handleLogin} onBack={() => setView('chooser')} onShowView={showView} />
      )}

      {/* USER LOGIN */}
      {view === 'user-login' && (
        <UserLogin mode="login" onLogin={handleLogin} onBack={() => setView('chooser')} onShowView={showView} />
      )}

      {/* USER SIGNUP */}
      {view === 'user-signup' && (
        <UserLogin mode="signup" onLogin={handleLogin} onBack={() => setView('landing')} onShowView={showView} />
      )}

      {/* USER DASHBOARD */}
      {view === 'user-dash' && <UserDashboard onLogout={handleLogout} />}

      {/* ADMIN DASHBOARD */}
      <div id="db-panel" className={view === 'admin-dash' ? 'open' : ''}>
        {/* TOPBAR */}
        <div id="db-topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 800, letterSpacing: '-0.5px' }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, overflow: 'hidden', flexShrink: 0 }}>
              <TpLogo size={32} />
            </div>
            <span>Fleet <span style={{ color: 'var(--amber)' }}>Command Center</span></span>
          </div>
          <div className="db-topbar-spacer" />
          <div style={{ fontSize: 12, color: 'rgba(241,245,249,0.3)', fontWeight: 400 }}>{new Date().toDateString()}</div>
          <div className="db-search">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(241,245,249,0.3)" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="text" placeholder="Search fleet, drivers, loads…" />
            <span style={{ fontSize: 10, color: 'rgba(241,245,249,0.2)', whiteSpace: 'nowrap' }}>⌘K</span>
          </div>
          <NotificationPanel />
          <button className="db-tbtn gold">+ New Dispatch</button>
          <button
            onClick={handleLogout}
            style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface2)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(241,245,249,0.5)', padding: '8px 16px', borderRadius: 9, fontSize: 13, fontWeight: 500, cursor: 'pointer', transition: 'all 0.2s', flexShrink: 0 }}
            onMouseOver={e => { e.currentTarget.style.borderColor = 'rgba(239,68,68,0.35)'; e.currentTarget.style.color = '#F87171'; }}
            onMouseOut={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = 'rgba(241,245,249,0.5)'; }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3"/></svg>
            Sign Out
          </button>
        </div>

        {/* BODY */}
        <div id="db-body">
          <Sidebar onLogout={handleLogout} />
          <div id="db-content">
            <Routes>
              <Route path="/" element={<Navigate to="/dispatch" replace />} />
              <Route path="/dispatch" element={<DispatchBoard />} />
              <Route path="/drivers" element={<Drivers />} />
              <Route path="/drivers/:id" element={<DriverProfile />} />
              <Route path="/fleet-twin" element={<FleetTwin />} />
              <Route path="/alerts" element={<AlertsFeed />} />
              <Route path="/billing" element={<BillingPipeline />} />
              <Route path="/cost" element={<CostIntelligence />} />
              <Route path="/companies" element={<Companies />} />
              <Route path="/companies/:code" element={<CompanyProfile />} />
              <Route path="/marketplace" element={<LoadMarketplace />} />
              <Route path="/agent-activity" element={<AgentActivity />} />
            </Routes>
          </div>
        </div>
      </div>
    </>
  );
}
