import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveData } from '../../hooks/useLiveData';
import { fmtDate } from '../../api/tms';
import { ApiDown, LiveNote, PageHeader, RecordTabs, SortTh } from '../ui';
import { sortRows, useSort } from '../listing';

function driverState(d) {
  if (d.current_shipment) return { label: 'On a load', cls: 'tms-s-info' };
  if (d.status === 'available') return { label: 'Available', cls: 'tms-s-ok' };
  return { label: 'Not available', cls: 'tms-s-bad' };
}

const DRIVER_SORT = {
  name: d => d.name, truck: d => d.truck_id, state: d => driverState(d).label,
  hos: d => d.hos_remaining, location: d => d.location,
};
const TRUCK_SORT = {
  id: t => t.id, model: t => `${t.make} ${t.model}`, status: t => t.status, driver: t => t.driver?.name,
  service: t => t.next_service, odometer: t => t.odometer,
};

function Drivers({ rows }) {
  const [sort, onSort] = useSort('name');
  return (
    <table className="tms-table">
      <thead>
        <tr>
          <SortTh id="name" sort={sort} onSort={onSort}>Driver</SortTh>
          <SortTh id="state" sort={sort} onSort={onSort}>Status</SortTh>
          <SortTh id="truck" sort={sort} onSort={onSort}>Truck</SortTh>
          <th>Current load</th>
          <SortTh id="hos" sort={sort} onSort={onSort} className="tms-num">Hours left today</SortTh>
          <SortTh id="location" sort={sort} onSort={onSort}>Last location</SortTh>
        </tr>
      </thead>
      <tbody>
        {sortRows(rows, sort, DRIVER_SORT).map(d => {
          const st = driverState(d);
          return (
            <tr key={d.id}>
              <td><span className="tms-id">{d.name}</span><div className="tms-sub">{d.phone}, {d.license}</div></td>
              <td><span className={`tms-status ${st.cls}`}>{st.label}</span></td>
              <td>{d.truck_id}</td>
              <td>{d.current_shipment
                ? <><Link to={`/tms/ops/shipments/${d.current_shipment.id}`}>{d.current_shipment.id}</Link>
                    <div className="tms-sub">{d.current_shipment.origin} to {d.current_shipment.destination}</div></>
                : <span className="tms-sub">None</span>}</td>
              <td className="tms-num">{d.hos_remaining !== null ? <span className={d.hos_remaining < 3 ? 'tms-inline-note warn' : ''}>{d.hos_remaining.toFixed(1)} h</span> : ''}</td>
              <td>{d.location}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Trucks({ rows }) {
  const [sort, onSort] = useSort('id');
  const today = new Date().toISOString().slice(0, 10);
  return (
    <table className="tms-table">
      <thead>
        <tr>
          <SortTh id="id" sort={sort} onSort={onSort}>Unit</SortTh>
          <SortTh id="model" sort={sort} onSort={onSort}>Make and model</SortTh>
          <SortTh id="status" sort={sort} onSort={onSort}>Status</SortTh>
          <SortTh id="driver" sort={sort} onSort={onSort}>Driver</SortTh>
          <th>Current load</th>
          <SortTh id="service" sort={sort} onSort={onSort}>Next service</SortTh>
          <SortTh id="odometer" sort={sort} onSort={onSort} className="tms-num">Odometer</SortTh>
        </tr>
      </thead>
      <tbody>
        {sortRows(rows, sort, TRUCK_SORT).map(t => (
          <tr key={t.id}>
            <td><span className="tms-id">{t.id}</span><div className="tms-sub">{t.plate}</div></td>
            <td>{t.year} {t.make} {t.model}</td>
            <td><span className={`tms-status ${t.status === 'In service' ? 'tms-s-ok' : 'tms-s-bad'}`}>{t.status}</span>
              {t.issue && <div className="tms-inline-note warn">{t.issue}</div>}</td>
            <td>{t.driver?.name || <span className="tms-sub">Unassigned</span>}</td>
            <td>{t.current_shipment
              ? <Link to={`/tms/ops/shipments/${t.current_shipment.id}`}>{t.current_shipment.id}</Link>
              : <span className="tms-sub">None</span>}</td>
            <td><span className={t.next_service < today ? 'tms-inline-note warn' : ''}>{fmtDate(`${t.next_service}T12:00:00-07:00`)}{t.next_service < today ? ', overdue' : ''}</span></td>
            <td className="tms-num">{t.odometer?.toLocaleString()} mi</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function OpsFleet() {
  const drivers = useLiveData('/api/drivers', 10000);
  const trucks = useLiveData('/api/trucks', 10000);
  const [tab, setTab] = useState('drivers');
  const d = drivers.data || [];
  const t = trucks.data || [];

  return (
    <>
      <PageHeader title="Drivers and trucks" subtitle="Our own fleet: who is available, and what's in the shop.">
        <LiveNote live={drivers} />
      </PageHeader>
      <ApiDown live={drivers} />
      <dl className="tms-metrics">
        <div className="tms-metric"><dt>Drivers available</dt><dd>{drivers.data ? d.filter(x => driverState(x).label === 'Available').length : '–'}</dd></div>
        <div className="tms-metric"><dt>Drivers on a load</dt><dd>{drivers.data ? d.filter(x => x.current_shipment).length : '–'}</dd></div>
        <div className="tms-metric"><dt>Trucks in service</dt><dd>{trucks.data ? t.filter(x => x.status === 'In service').length : '–'}</dd></div>
        <div className="tms-metric"><dt>Trucks in the shop</dt><dd>{trucks.data ? t.filter(x => x.status !== 'In service').length : '–'}</dd></div>
      </dl>
      <div className="tms-panel" style={{ overflowX: 'auto' }}>
        <RecordTabs tab={tab} onChange={setTab} tabs={[
          { id: 'drivers', label: `Drivers (${d.length})` },
          { id: 'trucks', label: `Trucks (${t.length})` },
        ]} />
        {tab === 'drivers' ? <Drivers rows={d} /> : <Trucks rows={t} />}
      </div>
    </>
  );
}
