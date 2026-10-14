import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveData } from '../../hooks/useLiveData';
import { fmtDate, fmtWindow } from '../../api/tms';
import { ApiDown, LiveNote, NotesPanel, PageHeader, RecordTabs, ShipmentStatus, Timeline, TrackingAlert } from '../ui';
import { MILESTONE_CODES, api, getSession, lane, weight } from '../lib';
import { OrderDetails, QuoteStatus } from '../portal/PortalPages';

// ── Shipments ────────────────────────────────────────────────────────

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'exceptions', label: 'Exceptions' },
  { id: 'active', label: 'Active' },
  { id: 'delivered', label: 'Delivered' },
];

export function OpsShipments() {
  const ships = useLiveData('/api/shipments', 3000);
  const [filter, setFilter] = useState('all');
  const navigate = useNavigate();

  const all = ships.data || [];
  const rows = all.filter(s =>
    filter === 'all' ? true
      : filter === 'exceptions' ? Boolean(s.tracking_alert)
        : filter === 'active' ? s.status !== 'Delivered' : s.status === 'Delivered');
  const active = all.filter(s => s.status !== 'Delivered');

  return (
    <>
      <PageHeader title="Shipments" subtitle="Every shipment, with its latest tracking.">
        <LiveNote live={ships} />
      </PageHeader>
      <ApiDown live={ships} />
      <dl className="tms-metrics">
        <div className="tms-metric"><dt>Active shipments</dt><dd>{ships.data ? active.length : '–'}</dd></div>
        <div className="tms-metric"><dt>In transit</dt><dd>{ships.data ? all.filter(s => s.status === 'In Transit').length : '–'}</dd></div>
        <div className="tms-metric"><dt>Exceptions</dt><dd>{ships.data ? all.filter(s => s.tracking_alert).length : '–'}</dd></div>
        <div className="tms-metric"><dt>No truck assigned</dt><dd>{ships.data ? active.filter(s => !s.truck_id).length : '–'}</dd></div>
      </dl>
      <div className="tms-panel" style={{ overflowX: 'auto' }}>
        <div className="tms-panel-h">
          <div className="tms-filters" role="group" aria-label="Filter shipments">
            {FILTERS.map(f => (
              <button key={f.id} className={filter === f.id ? 'on' : ''} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>{f.label}</button>
            ))}
          </div>
          <span className="tms-sub">{rows.length} shown</span>
        </div>
        <table className="tms-table">
          <thead>
            <tr><th>Shipment</th><th>Customer</th><th>Route</th><th>Carrier</th><th>Status</th><th>Last update</th><th>Delivery appointment</th></tr>
          </thead>
          <tbody>
            {rows.map(s => (
              <tr key={s.id} className="click" onClick={() => navigate(`/tms/ops/shipments/${s.id}`)}>
                <td><Link className="tms-id" to={`/tms/ops/shipments/${s.id}`} onClick={e => e.stopPropagation()}>{s.id}</Link><div className="tms-sub">{s.bol}</div></td>
                <td>{s.customer_name || s.customer_code}</td>
                <td>{s.origin} to {s.destination}</td>
                <td>{s.carrier_name}<div className="tms-sub">{s.truck_id || 'No truck assigned'}</div></td>
                <td><ShipmentStatus status={s.status} /><TrackingAlert alert={s.tracking_alert} /></td>
                <td>{s.last_milestone?.label}<div className="tms-sub">{s.last_milestone ? fmtDate(s.last_milestone.event_time) : ''}</div></td>
                <td>{fmtWindow(s.delivery_appt_start, s.delivery_appt_end)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {ships.data && rows.length === 0 && <p className="tms-empty">No shipments match this filter.</p>}
      </div>
    </>
  );
}

// ── Shipment detail ──────────────────────────────────────────────────

function nowLocalInput() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

/** Record a tracking milestone, as a dispatcher does after a check call. */
function AddMilestone({ shipment, onDone }) {
  const [code, setCode] = useState('INTRANSIT');
  const [when, setWhen] = useState(nowLocalInput);
  const [location, setLocation] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setSending(true); setError('');
    try {
      await api.post(`/api/shipments/${shipment.id}/milestones`, {
        code, event_time: new Date(when).toISOString(), location: location.trim() || undefined,
        source: 'staff', reason: 'Recorded by operations', author: getSession()?.name,
      }, { auth: true });
      setLocation('');
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <form className="tms-reply" onSubmit={submit}>
      <div className="tms-form-grid">
        <div className="tms-field">
          <label htmlFor="ms-code">Tracking update</label>
          <select id="ms-code" value={code} onChange={e => setCode(e.target.value)}>
            {MILESTONE_CODES.map(m => <option key={m.code} value={m.code}>{m.label}</option>)}
          </select>
        </div>
        <div className="tms-field">
          <label htmlFor="ms-when">When</label>
          <input id="ms-when" type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} required />
        </div>
        <div className="tms-field">
          <label htmlFor="ms-loc">Location</label>
          <input id="ms-loc" value={location} onChange={e => setLocation(e.target.value)} placeholder="City, ST" />
        </div>
      </div>
      <button className="tms-btn secondary" disabled={sending}>{sending ? 'Saving' : 'Add tracking update'}</button>
      {error && <div className="tms-error" style={{ marginTop: 10 }} role="alert">{error}</div>}
    </form>
  );
}

export function OpsShipment() {
  const { id } = useParams();
  const ship = useLiveData(`/api/shipments/${encodeURIComponent(id)}`, 3000);
  const [tab, setTab] = useState('tracking');
  const s = ship.data;

  if (ship.error && !s) {
    return <PageHeader crumb={<Link to="/tms/ops/shipments">Shipments</Link>} title={id} subtitle="Couldn't load this shipment." />;
  }
  if (!s) return <p className="tms-empty">Loading shipment</p>;

  return (
    <>
      <PageHeader crumb={<Link to="/tms/ops/shipments">Shipments</Link>} title={s.id}
                  subtitle={`${s.origin} to ${s.destination}, ${s.customer?.name || s.customer_code}`}>
        <ShipmentStatus status={s.status} />
        <LiveNote live={ship} />
      </PageHeader>
      <div className="tms-grid-2">
        <div className="tms-panel">
          <RecordTabs tab={tab} onChange={setTab} tabs={[
            { id: 'tracking', label: 'Tracking' },
            { id: 'notes', label: `Notes (${s.notes.length})` },
          ]} />
          <div className="tms-panel-b">
            {tab === 'tracking' && (
              <>
                {s.tracking_alert && <div className="tms-callout warn" style={{ marginBottom: 12 }}>{s.tracking_alert}</div>}
                <Timeline shipment={s} />
                {s.status !== 'Delivered' || !s.milestones.some(m => m.code === 'POD')
                  ? <AddMilestone shipment={s} onDone={ship.reload} /> : null}
              </>
            )}
            {tab === 'notes' && (
              <NotesPanel notes={s.notes} entityType="shipment" entityId={s.id} perspective="ops" onChange={ship.reload} />
            )}
          </div>
        </div>

        <section className="tms-panel">
          <div className="tms-panel-h"><h2>Details</h2></div>
          <dl className="tms-panel-b tms-kv">
            <div><dt>Customer</dt><dd>{s.customer?.name}</dd></div>
            <div><dt>Account</dt><dd>{s.customer?.on_hold ? <span className="tms-status tms-s-bad">On hold</span> : 'In good standing'}</dd></div>
            <div><dt>Carrier</dt><dd>{s.carrier_name}</dd></div>
            <div><dt>BOL</dt><dd>{s.bol}</dd></div>
            <div><dt>Truck</dt><dd>{s.truck_id || 'Not assigned'}</dd></div>
            <div><dt>Driver</dt><dd>{s.driver_name || 'Not assigned'}</dd></div>
            <div><dt>Load</dt><dd>{s.load_id || 'None'}</dd></div>
            <div><dt>Value</dt><dd>{s.amount}</dd></div>
            <div><dt>Pickup appointment</dt><dd>{fmtWindow(s.pickup_appt_start, s.pickup_appt_end)}</dd></div>
            <div><dt>Delivery appointment</dt><dd>{fmtWindow(s.delivery_appt_start, s.delivery_appt_end)}</dd></div>
          </dl>
        </section>
      </div>
    </>
  );
}

// ── Orders ───────────────────────────────────────────────────────────

const PAGE = 50;

export function OpsOrders() {
  const [source, setSource] = useState('');
  const [page, setPage] = useState(0);
  const live = useLiveData(`/api/orders?limit=${PAGE}&offset=${page * PAGE}${source ? `&source=${source}` : ''}`, 5000);
  const navigate = useNavigate();
  const rows = live.data?.items || [];
  const total = live.data?.total || 0;

  function show(next) {
    setSource(next);
    setPage(0);
  }

  return (
    <>
      <PageHeader title="Orders" subtitle={live.data ? `${total} orders` : ' '}>
        <LiveNote live={live} />
      </PageHeader>
      <ApiDown live={live} />
      <div className="tms-panel" style={{ overflowX: 'auto' }}>
        <div className="tms-panel-h">
          <div className="tms-filters" role="group" aria-label="Show orders">
            <button className={source === '' ? 'on' : ''} aria-pressed={source === ''} onClick={() => show('')}>All</button>
            <button className={source === 'portal' ? 'on' : ''} aria-pressed={source === 'portal'} onClick={() => show('portal')}>Quote requests</button>
          </div>
          <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span className="tms-sub">{total ? `${page * PAGE + 1}–${Math.min(total, (page + 1) * PAGE)} of ${total}` : ''}</span>
            <button className="tms-btn small secondary" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</button>
            <button className="tms-btn small secondary" disabled={(page + 1) * PAGE >= total} onClick={() => setPage(p => p + 1)}>Next</button>
          </span>
        </div>
        <table className="tms-table">
          <thead>
            <tr><th>Order</th><th>Lane</th><th className="tms-num">Weight</th><th>Class</th><th>Status</th><th>Quote</th><th>Created</th></tr>
          </thead>
          <tbody>
            {rows.map(o => (
              <tr key={o.id} className="click" onClick={() => navigate(`/tms/ops/orders/${o.id}`)}>
                <td><Link className="tms-id" to={`/tms/ops/orders/${o.id}`} onClick={e => e.stopPropagation()}>{o.id}</Link>
                  {o.source === 'portal' && <div className="tms-sub">Quote request</div>}</td>
                <td>{lane(o)}</td>
                <td className="tms-num">{weight(o)}</td>
                <td>{o.freight_class}</td>
                <td>{o.status}</td>
                <td><QuoteStatus order={o} /></td>
                <td>{fmtDate(o.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {live.data && rows.length === 0 && <p className="tms-empty">No orders here yet.</p>}
      </div>
    </>
  );
}

export function OpsOrder() {
  const { id } = useParams();
  const live = useLiveData(`/api/orders/${encodeURIComponent(id)}`, 3000);
  const [tab, setTab] = useState('details');
  const o = live.data;

  if (live.error && !o) {
    return <PageHeader crumb={<Link to="/tms/ops/orders">Orders</Link>} title={id} subtitle="Couldn't load this order." />;
  }
  if (!o) return <p className="tms-empty">Loading order</p>;

  return (
    <>
      <PageHeader crumb={<Link to="/tms/ops/orders">Orders</Link>} title={`Order ${o.id}`} subtitle={lane(o)}>
        <QuoteStatus order={o} />
        <LiveNote live={live} />
      </PageHeader>
      <div className="tms-panel">
        <RecordTabs tab={tab} onChange={setTab} tabs={[
          { id: 'details', label: 'Details' },
          { id: 'notes', label: `Notes (${o.notes.length})` },
        ]} />
        <div className="tms-panel-b">
          {tab === 'details' && <OrderDetails o={o} />}
          {tab === 'notes' && (
            <NotesPanel notes={o.notes} entityType="order" entityId={o.id} perspective="ops" onChange={live.reload} />
          )}
        </div>
      </div>
    </>
  );
}
