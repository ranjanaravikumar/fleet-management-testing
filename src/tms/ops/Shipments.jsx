import { useCallback, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveData } from '../../hooks/useLiveData';
import { fmtDate, fmtDateTime, fmtWindow } from '../../api/tms';
import { ApiDown, LiveNote, PageHeader, ShipmentStatus, TrackingAlert } from '../ui';
import { DataGrid } from '../grid';
import { downloadCsv, phxDay, todayPhx } from '../lib';

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
  const navigate = useNavigate();

  const all = useMemo(() => ships.data || [], [ships.data]);
  const active = all.filter(s => s.status !== 'Delivered');
  const today = todayPhx();

  const tabs = useMemo(() => [
    { id: 'all', label: 'All', test: () => true },
    { id: 'exceptions', label: 'Exceptions', test: s => Boolean(s.tracking_alert) },
    { id: 'unassigned', label: 'No truck', test: s => s.status !== 'Delivered' && (!s.truck_id || !s.driver_name) },
    { id: 'active', label: 'Active', test: s => s.status !== 'Delivered' },
    { id: 'today', label: 'Today', test: s => phxDay(s.pickup_appt_start) === today || phxDay(s.delivery_appt_start) === today },
    { id: 'delivered', label: 'Delivered', test: s => s.status === 'Delivered' },
    { id: 'billing', label: 'To invoice', test: s => s.status === 'Delivered' && s.invoice_status === 'Not invoiced' },
  ], [today]);

  const columns = useMemo(() => [
    {
      id: 'id', label: 'Shipment', fixed: true, sortBy: s => s.id,
      csv: s => s.id,
      render: s => (
        <>
          <Link className="tms-id" to={`/tms/ops/shipments/${s.id}`} onClick={e => e.stopPropagation()}>{s.id}</Link>
          <div className="tms-sub">{s.bol}{s.po_number ? `, ${s.po_number}` : ''}</div>
        </>
      ),
    },
    { id: 'customer', label: 'Customer', sortBy: s => s.customer_name || s.customer_code },
    {
      id: 'route', label: 'Route', sortBy: s => `${s.origin} ${s.destination}`,
      csv: s => `${s.origin} to ${s.destination}`,
      render: s => (
        <>{s.origin} to {s.destination}
          <div className="tms-sub">{s.commodity}{s.miles ? `, ${s.miles.toLocaleString()} mi` : ''}</div></>
      ),
    },
    {
      id: 'carrier', label: 'Carrier', sortBy: s => s.carrier_name,
      csv: s => `${s.carrier_name || ''}${s.truck_id ? ` (${s.truck_id})` : ''}`,
      render: s => (
        <>{s.carrier_name}
          <div className={s.truck_id ? 'tms-sub' : 'tms-inline-note warn'}>
            {s.truck_id ? `${s.truck_id}, ${s.driver_name || 'no driver'}` : 'No truck assigned'}</div></>
      ),
    },
    {
      id: 'status', label: 'Status', sortBy: s => (s.tracking_alert ? `0 ${s.status}` : s.status),
      csv: s => `${s.status}${s.tracking_alert ? ` — ${s.tracking_alert}` : ''}`,
      render: s => <><ShipmentStatus status={s.status} /><TrackingAlert alert={s.tracking_alert} /></>,
    },
    { id: 'pickup', label: 'Pickup', sortBy: s => s.pickup_appt_start, csv: s => s.pickup_appt_start, render: s => fmtDate(s.pickup_appt_start) },
    {
      id: 'delivery', label: 'Delivery appointment', sortBy: s => s.delivery_appt_start,
      csv: s => s.delivery_appt_start, render: s => fmtWindow(s.delivery_appt_start, s.delivery_appt_end),
    },
    {
      id: 'update', label: 'Last update', sortBy: s => s.last_check_call?.called_at ?? s.last_milestone?.event_time,
      csv: s => s.last_check_call
        ? `Check call ${s.last_check_call.called_at}${s.last_check_call.location ? ` @ ${s.last_check_call.location}` : ''}`
        : (s.last_milestone?.label ?? ''),
      render: s => {
        if (s.last_check_call) {
          const cc = s.last_check_call;
          return (
            <>
              Check call{cc.location ? ` — ${cc.location}` : ''}
              {cc.miles_out != null && <span className="tms-sub"> {cc.miles_out.toLocaleString()} mi out</span>}
              <div className="tms-sub">{fmtDateTime(cc.called_at)}</div>
            </>
          );
        }
        return (
          <>{s.last_milestone?.label}
            <div className="tms-sub">{s.last_milestone ? fmtDateTime(s.last_milestone.event_time) : ''}</div></>
        );
      },
    },
    { id: 'pro', label: 'PRO', off: true, sortBy: s => s.pro_number },
    { id: 'invoice', label: 'Invoice', off: true, sortBy: s => s.invoice_status },
    { id: 'amount', label: 'Value', off: true, num: true, sortBy: s => s.amount },
  ], []);

  const search = useCallback(s => [
    s.id, s.bol, s.po_number, s.pro_number, s.customer_ref, s.customer_name, s.customer_code, s.origin,
    s.destination, s.carrier_name, s.truck_id, s.driver_name, s.status, s.commodity,
  ], []);

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
      <DataGrid
        name="shipments" live={ships} rows={all} tabs={tabs} columns={columns} search={search}
        rowId={s => s.id} onOpen={s => navigate(`/tms/ops/shipments/${s.id}`)}
        initialSort={{ key: 'pickup', dir: 'desc' }}
        csvName={() => `shipments-${today}.csv`}
        bulkActions={[{
          id: 'export', label: 'Export selected',
          run: sel => downloadCsv(`shipments-${today}.csv`, CSV_COLUMNS, sel),
        }]}
        empty="No shipments match. Clear the search or pick another tab."
      />
    </>
  );
}
