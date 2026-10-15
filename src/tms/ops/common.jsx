import { Link, useNavigate } from 'react-router-dom';
import { fmtDate, fmtWindow } from '../../api/tms';
import { ShipmentStatus, TrackingAlert } from '../ui';
import { INVOICE_STATUS } from '../lib';

/** A compact shipments table for account pages (customer, carrier). */
export function ShipmentMiniTable({ rows, show = 'carrier' }) {
  const navigate = useNavigate();
  if (!rows.length) return <p className="tms-sub">No shipments yet.</p>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="tms-table">
        <thead>
          <tr><th>Shipment</th><th>Route</th><th>{show === 'carrier' ? 'Carrier' : 'Customer'}</th><th>Status</th>
            <th>Pickup</th><th>Delivery appointment</th><th>Invoice</th></tr>
        </thead>
        <tbody>
          {rows.map(s => (
            <tr key={s.id} className="click" onClick={() => navigate(`/tms/ops/shipments/${s.id}`)}>
              <td><Link className="tms-id" to={`/tms/ops/shipments/${s.id}`} onClick={e => e.stopPropagation()}>{s.id}</Link>
                <div className="tms-sub">{s.po_number}</div></td>
              <td>{s.origin} to {s.destination}</td>
              <td>{show === 'carrier' ? s.carrier_name : (s.customer_name || s.customer_code)}</td>
              <td><ShipmentStatus status={s.status} /><TrackingAlert alert={s.tracking_alert} /></td>
              <td>{fmtDate(s.pickup_appt_start)}</td>
              <td>{fmtWindow(s.delivery_appt_start, s.delivery_appt_end)}</td>
              <td>{s.status === 'Delivered' ? <span className={`tms-status ${INVOICE_STATUS[s.invoice_status]}`}>{s.invoice_status}</span> : <span className="tms-sub">After delivery</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
