import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveData } from '../../hooks/useLiveData';
import { fmtDate } from '../../api/tms';
import { ApiDown, ErrorNote, KV, LiveNote, NotesPanel, PageHeader, RecordTabs, SearchBox, SortTh } from '../ui';
import { matchesQuery, sortRows, useSort } from '../listing';
import { api, getSession, lane, money } from '../lib';
import { QuoteStatus } from '../portal/PortalPages';
import { ShipmentMiniTable } from './common';

const ACCESSORS = {
  name: c => c.name, city: c => `${c.city} ${c.province}`, terms: c => c.terms,
  active: c => c.active_shipments, total: c => c.total_shipments, orders: c => c.open_orders, balance: c => c.open_balance,
  standing: c => (c.on_hold ? 0 : 1),
};

export function OpsCustomers() {
  const live = useLiveData('/api/customers', 10000);
  const [q, setQ] = useState('');
  const [sort, onSort] = useSort('name');
  const navigate = useNavigate();
  const rows = sortRows((live.data || []).filter(c => matchesQuery(q, c.code, c.name, c.city, c.province, c.contact, c.email)), sort, ACCESSORS);

  return (
    <>
      <PageHeader title="Customers" subtitle="Accounts, credit standing and their freight.">
        <LiveNote live={live} />
      </PageHeader>
      <ApiDown live={live} />
      <div className="tms-panel" style={{ overflowX: 'auto' }}>
        <div className="tms-panel-h tms-toolbar">
          <span className="tms-sub">{live.data ? `${rows.length} accounts` : ''}</span>
          <SearchBox value={q} onChange={setQ} label="Search customers" placeholder="Search name, code, city, contact" />
        </div>
        <table className="tms-table">
          <thead>
            <tr>
              <SortTh id="name" sort={sort} onSort={onSort}>Customer</SortTh>
              <SortTh id="city" sort={sort} onSort={onSort}>Location</SortTh>
              <SortTh id="standing" sort={sort} onSort={onSort}>Account</SortTh>
              <SortTh id="terms" sort={sort} onSort={onSort}>Terms</SortTh>
              <SortTh id="active" sort={sort} onSort={onSort} className="tms-num">Active shipments</SortTh>
              <SortTh id="orders" sort={sort} onSort={onSort} className="tms-num">Open orders</SortTh>
              <SortTh id="balance" sort={sort} onSort={onSort} className="tms-num">Open invoices</SortTh>
            </tr>
          </thead>
          <tbody>
            {rows.map(c => (
              <tr key={c.code} className="click" onClick={() => navigate(`/tms/ops/customers/${c.code}`)}>
                <td><Link className="tms-id" to={`/tms/ops/customers/${c.code}`} onClick={e => e.stopPropagation()}>{c.name}</Link>
                  <div className="tms-sub">{c.code}{c.contact ? `, ${c.contact}` : ''}</div></td>
                <td>{[c.city, c.province].filter(Boolean).join(', ')}</td>
                <td>{c.on_hold ? <span className="tms-status tms-s-bad">On hold</span> : <span className="tms-status tms-s-ok">Good standing</span>}</td>
                <td>{c.terms}</td>
                <td className="tms-num">{c.active_shipments}</td>
                <td className="tms-num">{c.open_orders}</td>
                <td className="tms-num">{c.open_balance ? money(c.open_balance) : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {live.data && rows.length === 0 && <p className="tms-empty">No customers match.</p>}
      </div>
    </>
  );
}

function HoldForm({ c, onDone }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await api.patch(`/api/customers/${c.code}`, c.on_hold
        ? { on_hold: false, reason: reason.trim(), author: getSession()?.name }
        : { on_hold: true, hold_reason: reason.trim(), reason: reason.trim(), author: getSession()?.name }, { auth: true });
      setReason('');
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="tms-reply" onSubmit={submit}>
      <div className="tms-field">
        <label htmlFor="hold-reason">{c.on_hold ? 'Why release the hold?' : 'Why put the account on hold?'}</label>
        <input id="hold-reason" value={reason} onChange={e => setReason(e.target.value)} required
               placeholder={c.on_hold ? 'e.g. Past-due invoices paid' : 'e.g. Credit limit reached'} />
      </div>
      <button className={`tms-btn${c.on_hold ? '' : ' secondary'}`} disabled={busy || !reason.trim()}>
        {c.on_hold ? 'Release hold' : 'Put account on hold'}
      </button>
      <ErrorNote error={error} />
    </form>
  );
}

export function OpsCustomer() {
  const { code } = useParams();
  const live = useLiveData(`/api/customers/${encodeURIComponent(code)}`, 5000);
  const ships = useLiveData(`/api/shipments?customer_code=${encodeURIComponent(code)}`, 5000);
  const orders = useLiveData(`/api/orders?customer_code=${encodeURIComponent(code)}&limit=200`, 10000);
  const notes = useLiveData(`/api/notes?entity_type=customer&entity_id=${encodeURIComponent(code)}&limit=200`, 5000);
  const [tab, setTab] = useState('shipments');
  const c = live.data;
  const navigate = useNavigate();

  if (live.error && !c) {
    return <PageHeader crumb={<Link to="/tms/ops/customers">Customers</Link>} title={code} subtitle="Couldn't load this customer." />;
  }
  if (!c) return <p className="tms-empty">Loading customer</p>;
  const orderRows = orders.data?.items || [];
  const reload = () => { live.reload(); notes.reload(); };

  return (
    <>
      <PageHeader crumb={<Link to="/tms/ops/customers">Customers</Link>} title={c.name}
                  subtitle={`Account ${c.code}, ${[c.city, c.province, c.country].filter(Boolean).join(', ')}`}>
        {c.on_hold ? <span className="tms-status tms-s-bad">On hold</span> : <span className="tms-status tms-s-ok">Good standing</span>}
        <LiveNote live={live} />
      </PageHeader>
      <div className="tms-grid-2">
        <div className="tms-panel">
          <RecordTabs tab={tab} onChange={setTab} tabs={[
            { id: 'shipments', label: `Shipments (${ships.data?.length ?? 0})` },
            { id: 'orders', label: `Orders (${orders.data?.total ?? 0})` },
            { id: 'notes', label: `Notes (${notes.data?.length ?? 0})` },
          ]} />
          <div className="tms-panel-b">
            {tab === 'shipments' && <ShipmentMiniTable rows={ships.data || []} show="carrier" />}
            {tab === 'orders' && (orderRows.length ? (
              <table className="tms-table">
                <thead><tr><th>Order</th><th>Lane</th><th>Quote</th><th>Created</th></tr></thead>
                <tbody>
                  {orderRows.map(o => (
                    <tr key={o.id} className="click" onClick={() => navigate(`/tms/ops/orders/${o.id}`)}>
                      <td><Link className="tms-id" to={`/tms/ops/orders/${o.id}`} onClick={e => e.stopPropagation()}>{o.id}</Link></td>
                      <td>{lane(o)}</td>
                      <td>{o.shipment_id ? <span className="tms-status tms-s-ok">Booked</span> : <QuoteStatus order={o} />}</td>
                      <td>{fmtDate(o.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="tms-sub">No orders yet.</p>)}
            {tab === 'notes' && (
              <NotesPanel notes={notes.data || []} entityType="customer" entityId={c.code} perspective="ops" onChange={reload} />
            )}
          </div>
        </div>
        <section className="tms-panel">
          <div className="tms-panel-h"><h2>Account</h2></div>
          <div className="tms-panel-b">
            {c.on_hold ? <div className="tms-callout bad" style={{ marginBottom: 12 }}>On hold: {c.hold_reason || 'no reason recorded'}</div> : null}
            <KV items={[
              ['Contact', c.contact], ['Email', c.email], ['Phone', c.phone],
              ['Address', [c.address, c.city, c.province, c.postal].filter(Boolean).join(', ')],
              ['Payment terms', c.terms], ['Freight type', c.rec_type],
              ['Appointment required', c.appt_required ? 'Yes' : 'No'], ['Account type', c.type],
            ]} />
            <HoldForm c={c} onDone={reload} />
          </div>
        </section>
      </div>
    </>
  );
}
