import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveData } from '../../hooks/useLiveData';
import { fmtDate, fmtDateTime, fmtWindow } from '../../api/tms';
import { ApiDown, LiveNote, PageHeader, ShipmentStatus, Timeline } from '../ui';
import { PORTAL_CUSTOMER } from '../lib';
import HelpPanel from './HelpPanel';

const SHIPMENTS = `/api/portal/shipments?customer_code=${PORTAL_CUSTOMER}`;
const ORDERS = `/api/portal/orders?customer_code=${PORTAL_CUSTOMER}`;

function RecordNote({ alert, openCase }) {
  if (openCase) return <div className="tms-inline-note agent">{openCase.customer_status}</div>;
  if (alert) return <div className="tms-inline-note warn">{alert}</div>;
  return null;
}

// ── Shipments list ───────────────────────────────────────────────────

export function PortalShipments() {
  const live = useLiveData(SHIPMENTS, 3000);
  const navigate = useNavigate();
  const rows = live.data || [];
  const active = rows.filter(s => s.status !== 'Delivered').length;

  return (
    <>
      <PageHeader title="Shipments" subtitle={live.data ? `${active} active, ${rows.length - active} delivered` : ' '}>
        <LiveNote live={live} />
      </PageHeader>
      <ApiDown live={live} />
      <div className="tms-panel" style={{ overflowX: 'auto' }}>
        <table className="tms-table">
          <thead>
            <tr><th>Shipment</th><th>Route</th><th>Status</th><th>Delivery appointment</th><th className="tms-num">Value</th></tr>
          </thead>
          <tbody>
            {rows.map(s => (
              <tr key={s.id} className="click" onClick={() => navigate(`/tms/portal/shipments/${s.id}`)}>
                <td><Link className="tms-id" to={`/tms/portal/shipments/${s.id}`} onClick={e => e.stopPropagation()}>{s.id}</Link>
                  <div className="tms-sub">{s.bol}</div></td>
                <td>{s.origin} to {s.destination}<div className="tms-sub">{s.commodity}, {s.weight_lbs?.toLocaleString()} lb</div></td>
                <td><ShipmentStatus status={s.status} /><RecordNote alert={s.alert} openCase={s.open_case} /></td>
                <td>{fmtWindow(s.delivery_appt_start, s.delivery_appt_end)}</td>
                <td className="tms-num">{s.amount}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {live.data && rows.length === 0 && <p className="tms-empty">No shipments yet.</p>}
      </div>
    </>
  );
}

// ── Shipment detail ──────────────────────────────────────────────────

export function PortalShipment() {
  const { id } = useParams();
  const list = useLiveData(SHIPMENTS, 3000);
  const cases = useLiveData(`/api/cases?shipment_id=${encodeURIComponent(id)}`, 3000);
  const s = list.data?.find(x => x.id === id);

  if (list.data && !s) {
    return <PageHeader crumb={<Link to="/tms/portal">Shipments</Link>} title="Shipment not found"
                       subtitle={`${id} isn't one of your shipments.`} />;
  }
  if (!s) return <><ApiDown live={list} /><p className="tms-empty">Loading shipment</p></>;

  const refresh = () => { list.reload(); cases.reload(); };

  return (
    <>
      <PageHeader crumb={<Link to="/tms/portal">Shipments</Link>} title={s.id}
                  subtitle={`${s.origin} to ${s.destination}`}>
        <ShipmentStatus status={s.status} />
        <LiveNote live={list} />
      </PageHeader>
      <div className="tms-grid-2">
        <div className="tms-stack">
          <section className="tms-panel">
            <div className="tms-panel-h"><h2>Tracking</h2></div>
            <div className="tms-panel-b"><Timeline shipment={s} alert={s.alert} /></div>
          </section>
          <section className="tms-panel">
            <div className="tms-panel-h"><h2>Details</h2></div>
            <dl className="tms-panel-b tms-kv">
              <div><dt>BOL</dt><dd>{s.bol}</dd></div>
              <div><dt>Carrier</dt><dd>{s.carrier_name}</dd></div>
              <div><dt>Truck</dt><dd>{s.truck_id || 'Not assigned yet'}</dd></div>
              <div><dt>Driver</dt><dd>{s.driver_name || 'Not assigned yet'}</dd></div>
              <div><dt>Pickup appointment</dt><dd>{fmtWindow(s.pickup_appt_start, s.pickup_appt_end)}</dd></div>
              <div><dt>Delivery appointment</dt><dd>{fmtWindow(s.delivery_appt_start, s.delivery_appt_end)}</dd></div>
              <div><dt>Freight</dt><dd>{s.commodity}, {s.weight_lbs?.toLocaleString()} lb, {s.trailer}</dd></div>
              <div><dt>Value</dt><dd>{s.amount}</dd></div>
            </dl>
          </section>
        </div>
        <HelpPanel kind="shipment" recordId={s.id} alert={s.alert} cases={cases.data || []} onChange={refresh} />
      </div>
    </>
  );
}

// ── Orders and quotes ────────────────────────────────────────────────

function lane(o) {
  return `${o.origin_zip} (${o.origin_country}) to ${o.dest_zip} (${o.dest_country})`;
}

export function PortalOrders() {
  const live = useLiveData(ORDERS, 3000);
  const navigate = useNavigate();
  const rows = live.data || [];
  return (
    <>
      <PageHeader title="Orders and quotes" subtitle="Your recent orders and their quote status.">
        <LiveNote live={live} />
      </PageHeader>
      <ApiDown live={live} />
      <div className="tms-panel" style={{ overflowX: 'auto' }}>
        <table className="tms-table">
          <thead>
            <tr><th>Order</th><th>Lane</th><th className="tms-num">Weight</th><th>Class</th><th>Quote</th><th>Created</th></tr>
          </thead>
          <tbody>
            {rows.map(o => (
              <tr key={o.id} className="click" onClick={() => navigate(`/tms/portal/orders/${o.id}`)}>
                <td><Link className="tms-id" to={`/tms/portal/orders/${o.id}`} onClick={e => e.stopPropagation()}>{o.id}</Link></td>
                <td>{lane(o)}</td>
                <td className="tms-num">{Number(o.weight_lbs).toLocaleString()} lb</td>
                <td>{o.freight_class}</td>
                <td>
                  <span className={`tms-status ${o.quote_status === 'Quote pending' ? 'tms-s-warn' : 'tms-s-ok'}`}>{o.quote_status}</span>
                  <RecordNote openCase={o.open_case} />
                </td>
                <td>{fmtDate(o.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function PortalOrder() {
  const { id } = useParams();
  const list = useLiveData(ORDERS, 3000);
  const cases = useLiveData(`/api/cases?order_id=${encodeURIComponent(id)}`, 3000);
  const o = list.data?.find(x => x.id === id);

  if (list.data && !o) {
    return <PageHeader crumb={<Link to="/tms/portal/orders">Orders and quotes</Link>} title="Order not found"
                       subtitle={`${id} isn't in your recent orders.`} />;
  }
  if (!o) return <><ApiDown live={list} /><p className="tms-empty">Loading order</p></>;

  const dims = (o.skid_dims || '').toLowerCase();
  return (
    <>
      <PageHeader crumb={<Link to="/tms/portal/orders">Orders and quotes</Link>} title={`Order ${o.id}`} subtitle={lane(o)}>
        <span className={`tms-status ${o.quote_status === 'Quote pending' ? 'tms-s-warn' : 'tms-s-ok'}`}>{o.quote_status}</span>
        <LiveNote live={list} />
      </PageHeader>
      <div className="tms-grid-2">
        <section className="tms-panel">
          <div className="tms-panel-h"><h2>Order details</h2></div>
          <dl className="tms-panel-b tms-kv">
            <div><dt>Origin</dt><dd>{o.origin_zip}, {o.origin_country}</dd></div>
            <div><dt>Destination</dt><dd>{o.dest_zip}, {o.dest_country}</dd></div>
            <div><dt>Weight</dt><dd>{Number(o.weight_lbs).toLocaleString()} lb</dd></div>
            <div><dt>Freight class</dt><dd>{o.freight_class}</dd></div>
            <div><dt>Pallets</dt><dd>{o.skid_details || 'Not provided'}</dd></div>
            <div><dt>Pallet size</dt><dd>{dims && dims !== 'unknown' ? `${o.skid_dims} in` : 'Not provided'}</dd></div>
            <div><dt>Quote</dt><dd>{o.quote_status}</dd></div>
            <div><dt>Last updated</dt><dd>{fmtDateTime(o.last_updated_timestamp)}</dd></div>
          </dl>
        </section>
        <HelpPanel kind="order" recordId={o.id} alert={null} cases={cases.data || []}
                   onChange={() => { list.reload(); cases.reload(); }} />
      </div>
    </>
  );
}
