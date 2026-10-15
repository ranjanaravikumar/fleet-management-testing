import { useState } from 'react';
import { Navigate, Outlet, Route, Routes, useNavigate } from 'react-router-dom';
import './tms.css';
import { TMS_API_URL } from '../api/tms';
import { useLiveData } from '../hooks/useLiveData';
import { PORTAL_CUSTOMER, getSession, setSession } from './lib';
import { SideNav, Tabs, TopBar } from './ui';
import { PortalOrder, PortalOrders, PortalRequestQuote, PortalShipment, PortalShipments } from './portal/PortalPages';
import {
  OpsCarrier, OpsCarriers, OpsCustomer, OpsCustomers, OpsDashboard, OpsDispatch, OpsFleet, OpsMap,
  OpsNewOrder, OpsOrder, OpsOrders, OpsShipment, OpsShipments,
} from './ops/OpsPages';

// ── Sign-in ──────────────────────────────────────────────────────────

function SignIn() {
  const navigate = useNavigate();
  const account = useLiveData(`/api/customers/${PORTAL_CUSTOMER}`, 60000);
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const customer = account.data;

  function asCustomer() {
    setSession({ role: 'customer', name: customer?.contact || 'Customer', company: customer?.name || '' });
    navigate('/tms/portal');
  }

  async function asOps(e) {
    e.preventDefault();
    setChecking(true); setError('');
    try {
      const res = await fetch(`${TMS_API_URL}/api/auth/check`, {
        headers: { 'X-API-Key': key, 'ngrok-skip-browser-warning': '1' },
      });
      if (res.status === 401) throw new Error('That access key is not valid.');
      if (!res.ok) throw new Error(`The TMS answered with an error (${res.status}).`);
      setSession({ role: 'ops', name: 'Alex Rivera', company: 'Operations', key });
      navigate('/tms/ops');
    } catch (err) {
      setError(err.message === 'Failed to fetch' ? `Can't reach the TMS at ${TMS_API_URL}.` : err.message);
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="tms">
      <TopBar area="portal" />
      <main className="tms-signin">
        <div className="tms-signin-box">
          <h1>Sign in to TruckerPath</h1>
          <p className="tms-sub">Choose how you're signing in.</p>
          <div className="tms-signin-grid">
            <section className="tms-panel">
              <div className="tms-panel-h"><h2>Customer portal</h2></div>
              <div className="tms-panel-b">
                <p>Track shipments, see orders and quotes, and request a quote.</p>
                <dl className="tms-kv" style={{ gridTemplateColumns: '1fr', marginBottom: 14 }}>
                  <div><dt>Account</dt><dd>{customer ? `${customer.name} (${customer.code})` : 'Loading'}</dd></div>
                  <div><dt>Signed in as</dt><dd>{customer?.contact || ' '}</dd></div>
                </dl>
                <button className="tms-btn" onClick={asCustomer} disabled={!customer}>Continue as customer</button>
                {account.error && !customer && <p className="tms-sub" style={{ marginTop: 10 }}>Can't reach the TMS at {TMS_API_URL}.</p>}
              </div>
            </section>
            <section className="tms-panel">
              <div className="tms-panel-h"><h2>Operations console</h2></div>
              <form className="tms-panel-b" onSubmit={asOps}>
                <p>Shipments, dispatch, orders, customers, carriers and billing.</p>
                <div className="tms-field">
                  <label htmlFor="ops-key">Access key</label>
                  <input id="ops-key" type="password" autoComplete="current-password" value={key}
                         onChange={e => setKey(e.target.value)} required />
                </div>
                <button className="tms-btn" disabled={checking || !key}>{checking ? 'Checking' : 'Sign in'}</button>
                {error && <div className="tms-error" style={{ marginTop: 10, marginBottom: 0 }} role="alert">{error}</div>}
              </form>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}

// ── Layouts ──────────────────────────────────────────────────────────

function RequireRole({ role, children }) {
  const session = getSession();
  if (!session || session.role !== role) return <Navigate to="/tms" replace />;
  return children;
}

function PortalLayout() {
  return (
    <div className="tms">
      <TopBar area="portal" />
      <Tabs items={[
        { to: '/tms/portal', label: 'Shipments', end: true },
        { to: '/tms/portal/orders', label: 'Orders and quotes' },
        { to: '/tms/portal/quote', label: 'Request a quote' },
      ]} />
      <main className="tms-main"><div className="tms-main-narrow"><Outlet /></div></main>
    </div>
  );
}

function OpsLayout() {
  const ships = useLiveData('/api/shipments?status=active', 10000);
  const exceptions = (ships.data || []).filter(s => s.tracking_alert).length;
  return (
    <div className="tms">
      <TopBar area="ops" />
      <div className="tms-body">
        <SideNav items={[
          { to: '/tms/ops/home', label: 'Today' },
          { group: 'Operations' },
          { to: '/tms/ops/shipments', label: 'Shipments', count: exceptions },
          { to: '/tms/ops/dispatch', label: 'Dispatch board' },
          { to: '/tms/ops/map', label: 'Map' },
          { group: 'Sales' },
          { to: '/tms/ops/orders', label: 'Orders' },
          { to: '/tms/ops/customers', label: 'Customers' },
          { group: 'Carriers and fleet' },
          { to: '/tms/ops/carriers', label: 'Carriers' },
          { to: '/tms/ops/fleet', label: 'Drivers and trucks' },
        ]} />
        <main className="tms-main"><Outlet /></main>
      </div>
    </div>
  );
}

// ── Routes ───────────────────────────────────────────────────────────

export default function TmsApp() {
  return (
    <Routes>
      <Route path="/tms" element={<SignIn />} />
      <Route path="/tms/portal" element={<RequireRole role="customer"><PortalLayout /></RequireRole>}>
        <Route index element={<PortalShipments />} />
        <Route path="shipments/:id" element={<PortalShipment />} />
        <Route path="orders" element={<PortalOrders />} />
        <Route path="orders/:id" element={<PortalOrder />} />
        <Route path="quote" element={<PortalRequestQuote />} />
        <Route path="orders/new" element={<Navigate to="/tms/portal/quote" replace />} />
      </Route>
      <Route path="/tms/ops" element={<RequireRole role="ops"><OpsLayout /></RequireRole>}>
        <Route index element={<Navigate to="home" replace />} />
        <Route path="home" element={<OpsDashboard />} />
        <Route path="shipments" element={<OpsShipments />} />
        <Route path="shipments/:id" element={<OpsShipment />} />
        <Route path="dispatch" element={<OpsDispatch />} />
        <Route path="map" element={<OpsMap />} />
        <Route path="orders" element={<OpsOrders />} />
        <Route path="orders/new" element={<OpsNewOrder />} />
        <Route path="orders/:id" element={<OpsOrder />} />
        <Route path="customers" element={<OpsCustomers />} />
        <Route path="customers/:code" element={<OpsCustomer />} />
        <Route path="carriers" element={<OpsCarriers />} />
        <Route path="carriers/:code" element={<OpsCarrier />} />
        <Route path="fleet" element={<OpsFleet />} />
      </Route>
      <Route path="/tms/*" element={<Navigate to="/tms" replace />} />
    </Routes>
  );
}
