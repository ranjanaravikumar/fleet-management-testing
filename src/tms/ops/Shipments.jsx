import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveData } from '../../hooks/useLiveData';
import { fmtDate, fmtDateTime, fmtWindow } from '../../api/tms';
import { ApiDown, FilterChips, LiveNote, PageHeader, SearchBox, ShipmentStatus, SortTh, TrackingAlert } from '../ui';
import { matchesQuery, sortRows, useSort } from '../listing';
import { downloadCsv, phxDay, todayPhx } from '../lib';

const ACCESSORS = {
  id: s => s.id,
  customer: s => s.customer_name || s.customer_code,
  route: s => `${s.origin} ${s.destination}`,
  carrier: s => s.carrier_name,
  status: s => (s.tracking_alert ? `0 ${s.status}` : s.status),
  pickup: s => s.pickup_appt_start,
  delivery: s => s.delivery_appt_start,
  update: s => s.last_milestone?.event_time,
};

const CSV_COLUMNS = [
  { label: 'Shipment', value: s => s.id },
  { label: 'BOL', value: s => s.bol },
  { label: 'PO', value: s => s.po_number },
  { label: 'PRO', value: s => s.pro_number },
  { label: 'Customer', value: s => s.customer_name || s.customer_code },
  { label: 'Origin', value: s => s.origin },
  { label: 'Destination', value: s => s.destination },
  { label: 'Carrier', value: s => s.carrier_name },
  { label: 'Truck', value: s => s.truck_id },
  { label: 'Driver', value: s => s.driver_name },
  { label: 'Status', value: s => s.status },
  { label: 'Exception', value: s => s.tracking_alert },
  { label: 'Pickup appointment', value: s => s.pickup_appt_start },
  { label: 'Delivery appointment', value: s => s.delivery_appt_start },
  { label: 'Value', value: s => s.amount },
  { label: 'Invoice', value: s => s.invoice_status },
];

export function OpsShipments() {
  const ships = useLiveData('/api/shipments', 3000);
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [sort, onSort] = useSort('pickup', 'desc');
  const navigate = useNavigate();

  const all = ships.data || [];
  const active = all.filter(s => s.status !== 'Delivered');
  const today = todayPhx();
  const tests = {
    all: () => true,
    exceptions: s => Boolean(s.tracking_alert),
    unassigned: s => s.status !== 'Delivered' && (!s.truck_id || !s.driver_name),
    active: s => s.status !== 'Delivered',
    today: s => phxDay(s.pickup_appt_start) === today || phxDay(s.delivery_appt_start) === today,
    delivered: s => s.status === 'Delivered',
    billing: s => s.status === 'Delivered' && s.invoice_status === 'Not invoiced',
  };
  const filters = [
    { id: 'all', label: 'All' }, { id: 'exceptions', label: 'Exceptions' }, { id: 'unassigned', label: 'No truck or driver' },
    { id: 'active', label: 'Active' }, { id: 'today', label: 'Today' }, { id: 'delivered', label: 'Delivered' },
    { id: 'billing', label: 'Ready to invoice' },
  ].map(f => ({ ...f, count: ships.data ? all.filter(tests[f.id]).length : undefined }));

  const rows = sortRows(all.filter(tests[filter]).filter(s => matchesQuery(q,
    s.id, s.bol, s.po_number, s.pro_number, s.customer_ref, s.customer_name, s.customer_code, s.origin,
    s.destination, s.carrier_name, s.truck_id, s.driver_name, s.status, s.commodity)), sort, ACCESSORS);

  return (
    <>
      <PageHeader title="Shipments" subtitle="Every shipment, with its latest tracking.">
        <LiveNote live={ships} />
        <button className="tms-btn secondary small" disabled={!rows.length}
                onClick={() => downloadCsv(`shipments-${today}.csv`, CSV_COLUMNS, rows)}>Export CSV</button>
      </PageHeader>
      <ApiDown live={ships} />
      <dl className="tms-metrics">
        <div className="tms-metric"><dt>Active shipments</dt><dd>{ships.data ? active.length : '–'}</dd></div>
        <div className="tms-metric"><dt>In transit</dt><dd>{ships.data ? all.filter(s => s.status === 'In Transit').length : '–'}</dd></div>
        <div className="tms-metric"><dt>Exceptions</dt><dd>{ships.data ? all.filter(s => s.tracking_alert).length : '–'}</dd></div>
        <div className="tms-metric"><dt>No truck assigned</dt><dd>{ships.data ? active.filter(s => !s.truck_id).length : '–'}</dd></div>
      </dl>
      <div className="tms-panel" style={{ overflowX: 'auto' }}>
        <div className="tms-panel-h tms-toolbar">
          <FilterChips items={filters} value={filter} onChange={setFilter} label="Filter shipments" />
          <SearchBox value={q} onChange={setQ} label="Search shipments" placeholder="Search ID, PO, PRO, customer, carrier, city" />
        </div>
        <table className="tms-table">
          <thead>
            <tr>
              <SortTh id="id" sort={sort} onSort={onSort}>Shipment</SortTh>
              <SortTh id="customer" sort={sort} onSort={onSort}>Customer</SortTh>
              <SortTh id="route" sort={sort} onSort={onSort}>Route</SortTh>
              <SortTh id="carrier" sort={sort} onSort={onSort}>Carrier</SortTh>
              <SortTh id="status" sort={sort} onSort={onSort}>Status</SortTh>
              <SortTh id="pickup" sort={sort} onSort={onSort}>Pickup</SortTh>
              <SortTh id="delivery" sort={sort} onSort={onSort}>Delivery appointment</SortTh>
              <SortTh id="update" sort={sort} onSort={onSort}>Last update</SortTh>
            </tr>
          </thead>
          <tbody>
            {rows.map(s => (
              <tr key={s.id} className="click" onClick={() => navigate(`/tms/ops/shipments/${s.id}`)}>
                <td><Link className="tms-id" to={`/tms/ops/shipments/${s.id}`} onClick={e => e.stopPropagation()}>{s.id}</Link>
                  <div className="tms-sub">{s.bol}{s.po_number ? `, ${s.po_number}` : ''}</div></td>
                <td>{s.customer_name || s.customer_code}</td>
                <td>{s.origin} to {s.destination}<div className="tms-sub">{s.commodity}{s.miles ? `, ${s.miles.toLocaleString()} mi` : ''}</div></td>
                <td>{s.carrier_name}<div className={s.truck_id ? 'tms-sub' : 'tms-inline-note warn'}>{s.truck_id ? `${s.truck_id}, ${s.driver_name || 'no driver'}` : 'No truck assigned'}</div></td>
                <td><ShipmentStatus status={s.status} /><TrackingAlert alert={s.tracking_alert} /></td>
                <td>{fmtDate(s.pickup_appt_start)}</td>
                <td>{fmtWindow(s.delivery_appt_start, s.delivery_appt_end)}</td>
                <td>{s.last_milestone?.label}<div className="tms-sub">{s.last_milestone ? fmtDateTime(s.last_milestone.event_time) : ''}</div></td>
              </tr>
            ))}
          </tbody>
        </table>
        {ships.data && rows.length === 0 && <p className="tms-empty">No shipments match. Clear the search or pick another filter.</p>}
      </div>
    </>
  );
}
