import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveData } from '../../hooks/useLiveData';
import { fmtDate } from '../../api/tms';
import { ApiDown, KV, LiveNote, NotesPanel, PageHeader, RecordTabs, SearchBox, SortTh } from '../ui';
import { matchesQuery, sortRows, useSort } from '../listing';
import { ShipmentMiniTable } from './common';
import { insuranceState } from '../lib';

const ACCESSORS = {
  name: c => c.name, base: c => c.home_base, equipment: c => c.equipment,
  insurance: c => c.insurance_days_left, ontime: c => c.on_time_pct, active: c => c.active_shipments, status: c => c.status,
};

function CarrierStatus({ c }) {
  return <span className={`tms-status ${c.status === 'Active' ? 'tms-s-ok' : 'tms-s-bad'}`}>{c.status}</span>;
}

function Insurance({ c }) {
  const st = insuranceState(c.insurance_days_left);
  return <><span className={`tms-status ${st.cls}`}>{st.label}</span><div className="tms-sub">{fmtDate(`${c.insurance_expires}T12:00:00-07:00`)}</div></>;
}

export function OpsCarriers() {
  const live = useLiveData('/api/carriers', 10000);
  const [q, setQ] = useState('');
  const [sort, onSort] = useSort('name');
  const navigate = useNavigate();
  const rows = sortRows((live.data || []).filter(c => matchesQuery(q, c.code, c.name, c.mc_number, c.dot_number, c.home_base, c.equipment)), sort, ACCESSORS);

  return (
    <>
      <PageHeader title="Carriers" subtitle="Who hauls our freight, and whether they're cleared to.">
        <LiveNote live={live} />
      </PageHeader>
      <ApiDown live={live} />
      <div className="tms-panel" style={{ overflowX: 'auto' }}>
        <div className="tms-panel-h tms-toolbar">
          <span className="tms-sub">{live.data ? `${rows.length} carriers` : ''}</span>
          <SearchBox value={q} onChange={setQ} label="Search carriers" placeholder="Search name, MC, DOT, city" />
        </div>
        <table className="tms-table">
          <thead>
            <tr>
              <SortTh id="name" sort={sort} onSort={onSort}>Carrier</SortTh>
              <SortTh id="base" sort={sort} onSort={onSort}>Home base</SortTh>
              <SortTh id="equipment" sort={sort} onSort={onSort}>Equipment</SortTh>
              <SortTh id="insurance" sort={sort} onSort={onSort}>Insurance</SortTh>
              <SortTh id="ontime" sort={sort} onSort={onSort} className="tms-num">On time</SortTh>
              <SortTh id="active" sort={sort} onSort={onSort} className="tms-num">Active loads</SortTh>
              <SortTh id="status" sort={sort} onSort={onSort}>Status</SortTh>
            </tr>
          </thead>
          <tbody>
            {rows.map(c => (
              <tr key={c.code} className="click" onClick={() => navigate(`/tms/ops/carriers/${c.code}`)}>
                <td><Link className="tms-id" to={`/tms/ops/carriers/${c.code}`} onClick={e => e.stopPropagation()}>{c.name}</Link>
                  <div className="tms-sub">{c.mc_number}, DOT {c.dot_number}{c.own_fleet ? ', own fleet' : ''}</div></td>
                <td>{c.home_base}</td>
                <td>{c.equipment}</td>
                <td><Insurance c={c} /></td>
                <td className="tms-num">{c.on_time_pct}%</td>
                <td className="tms-num">{c.active_shipments}</td>
                <td><CarrierStatus c={c} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {live.data && rows.length === 0 && <p className="tms-empty">No carriers match.</p>}
      </div>
    </>
  );
}

export function OpsCarrier() {
  const { code } = useParams();
  const live = useLiveData(`/api/carriers/${encodeURIComponent(code)}`, 5000);
  const ships = useLiveData(`/api/shipments?carrier_code=${encodeURIComponent(code)}`, 5000);
  const [tab, setTab] = useState('shipments');
  const c = live.data;

  if (live.error && !c) {
    return <PageHeader crumb={<Link to="/tms/ops/carriers">Carriers</Link>} title={code} subtitle="Couldn't load this carrier." />;
  }
  if (!c) return <p className="tms-empty">Loading carrier</p>;
  const ins = insuranceState(c.insurance_days_left);

  return (
    <>
      <PageHeader crumb={<Link to="/tms/ops/carriers">Carriers</Link>} title={c.name}
                  subtitle={`${c.mc_number}, DOT ${c.dot_number}, ${c.home_base}`}>
        <CarrierStatus c={c} />
        <LiveNote live={live} />
      </PageHeader>
      <div className="tms-grid-2">
        <div className="tms-panel">
          <RecordTabs tab={tab} onChange={setTab} tabs={[
            { id: 'shipments', label: `Shipments (${ships.data?.length ?? 0})` },
            { id: 'notes', label: `Notes (${c.notes.length})` },
          ]} />
          <div className="tms-panel-b">
            {tab === 'shipments' && <ShipmentMiniTable rows={ships.data || []} show="customer" />}
            {tab === 'notes' && <NotesPanel notes={c.notes} entityType="carrier" entityId={c.code} perspective="ops" onChange={live.reload} />}
          </div>
        </div>
        <section className="tms-panel">
          <div className="tms-panel-h"><h2>Carrier profile</h2></div>
          <div className="tms-panel-b">
            {ins.cls !== 'tms-s-ok' && (
              <div className={`tms-callout ${ins.cls === 'tms-s-bad' ? 'bad' : 'warn'}`} style={{ marginBottom: 12 }}>
                Insurance: {ins.label.toLowerCase()}.{c.status !== 'Active' ? ' New loads can\'t be given to this carrier.' : ' Ask for a renewed certificate.'}
              </div>
            )}
            <KV items={[
              ['Contact', c.contact], ['Phone', c.phone], ['Email', c.email],
              ['Equipment', c.equipment], ['Insurance expires', fmtDate(`${c.insurance_expires}T12:00:00-07:00`)],
              ['On-time delivery', `${c.on_time_pct}%`], ['Active loads', c.active_shipments], ['All loads', c.total_shipments],
              ['Type', c.own_fleet ? 'Our own fleet' : 'Outside carrier'],
            ]} />
          </div>
        </section>
      </div>
    </>
  );
}
