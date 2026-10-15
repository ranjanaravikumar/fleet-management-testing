import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveData } from '../../hooks/useLiveData';
import { fmtDate } from '../../api/tms';
import { ApiDown, ErrorNote, FilterChips, LiveNote, NotesPanel, PageHeader, RecordTabs, SearchBox, SortTh } from '../ui';
import { matchesQuery, sortRows, useSort } from '../listing';
import { api, fromPhxInput, getSession, lane, toPhxInput, weight } from '../lib';
import { OrderDetails, QuoteStatus } from '../portal/PortalPages';

const PAGE = 50;

const quoted = o => o.quote_status !== 'Quote pending';
const TESTS = {
  all: () => true,
  portal: o => o.source === 'portal',
  pending: o => !quoted(o) && !o.shipment_id,
  ready: o => quoted(o) && !o.shipment_id,
  booked: o => Boolean(o.shipment_id),
};

const ACCESSORS = {
  id: o => o.id,
  lane: o => lane(o),
  weight: o => Number(String(o.weight_lbs).replace(/[^\d.]/g, '')) || null,
  class: o => Number(o.freight_class) || null,
  status: o => o.status,
  quote: o => Number(String(o.quote).replace(/[^\d.]/g, '')) || null,
  created: o => o.created_at,
};

function OrderState({ o }) {
  if (o.shipment_id) return <span className="tms-status tms-s-ok">Booked</span>;
  return <QuoteStatus order={o} />;
}

export function OpsOrders() {
  const live = useLiveData('/api/orders?limit=500', 5000);
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [sort, onSort] = useSort('created', 'desc');
  const navigate = useNavigate();
  const all = live.data?.items || [];

  const chips = [
    { id: 'all', label: 'All' }, { id: 'portal', label: 'Quote requests' }, { id: 'pending', label: 'Needs a quote' },
    { id: 'ready', label: 'Quoted, not booked' }, { id: 'booked', label: 'Booked' },
  ].map(c => ({ ...c, count: live.data ? all.filter(TESTS[c.id]).length : undefined }));

  const filtered = sortRows(all.filter(TESTS[filter]).filter(o => matchesQuery(q,
    o.id, o.origin_zip, o.origin_state, o.origin_country, o.dest_zip, o.dest_state, o.dest_country,
    o.commodity, o.status, o.freight_class, o.shipment_id)), sort, ACCESSORS);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const current = Math.min(page, pages - 1);
  const rows = filtered.slice(current * PAGE, (current + 1) * PAGE);
  const choose = setter => v => { setter(v); setPage(0); };

  return (
    <>
      <PageHeader title="Orders" subtitle={live.data ? `${all.length} orders and quote requests` : ' '}>
        <LiveNote live={live} />
      </PageHeader>
      <ApiDown live={live} />
      <div className="tms-panel" style={{ overflowX: 'auto' }}>
        <div className="tms-panel-h tms-toolbar">
          <FilterChips items={chips} value={filter} onChange={choose(setFilter)} label="Show orders" />
          <SearchBox value={q} onChange={choose(setQ)} label="Search orders" placeholder="Search order, ZIP, state, commodity" />
        </div>
        <table className="tms-table">
          <thead>
            <tr>
              <SortTh id="id" sort={sort} onSort={onSort}>Order</SortTh>
              <SortTh id="lane" sort={sort} onSort={onSort}>Lane</SortTh>
              <SortTh id="weight" sort={sort} onSort={onSort} className="tms-num">Weight</SortTh>
              <SortTh id="class" sort={sort} onSort={onSort}>Class</SortTh>
              <SortTh id="status" sort={sort} onSort={onSort}>Order status</SortTh>
              <SortTh id="quote" sort={sort} onSort={onSort}>Quote</SortTh>
              <SortTh id="created" sort={sort} onSort={onSort}>Created</SortTh>
            </tr>
          </thead>
          <tbody>
            {rows.map(o => (
              <tr key={o.id} className="click" onClick={() => navigate(`/tms/ops/orders/${o.id}`)}>
                <td><Link className="tms-id" to={`/tms/ops/orders/${o.id}`} onClick={e => e.stopPropagation()}>{o.id}</Link>
                  {o.source === 'portal' && <div className="tms-sub">Quote request</div>}
                  {o.shipment_id && <div className="tms-sub">Shipment {o.shipment_id}</div>}</td>
                <td>{lane(o)}</td>
                <td className="tms-num">{weight(o)}</td>
                <td>{o.freight_class}</td>
                <td>{o.status}</td>
                <td><OrderState o={o} /></td>
                <td>{fmtDate(o.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {live.data && rows.length === 0 && <p className="tms-empty">No orders match. Clear the search or pick another filter.</p>}
        {filtered.length > PAGE && (
          <div className="tms-panel-h" style={{ borderTop: '1px solid var(--line-2)', borderBottom: 'none' }}>
            <span className="tms-sub">{current * PAGE + 1}–{Math.min(filtered.length, (current + 1) * PAGE)} of {filtered.length}</span>
            <span className="tms-actions">
              <button className="tms-btn small secondary" disabled={current === 0} onClick={() => setPage(current - 1)}>Previous</button>
              <button className="tms-btn small secondary" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>Next</button>
            </span>
          </div>
        )}
      </div>
    </>
  );
}

// ── Booking a quoted order ───────────────────────────────────────────

function at(daysAhead, hour) {
  const d = new Date(Date.now() + daysAhead * 86400000);
  return `${toPhxInput(d.toISOString()).slice(0, 10)}T${String(hour).padStart(2, '0')}:00`;
}

function BookShipment({ o }) {
  const navigate = useNavigate();
  const carriers = useLiveData('/api/carriers', 60000);
  const drivers = useLiveData('/api/drivers', 60000);
  const trucks = useLiveData('/api/trucks', 60000);
  const [f, setF] = useState(() => ({
    origin: [o.origin_zip, o.origin_state].filter(Boolean).join(', '),
    destination: [o.dest_zip, o.dest_state].filter(Boolean).join(', '),
    pickup_appt_start: at(1, 8), pickup_appt_end: at(1, 10),
    delivery_appt_start: at(3, 8), delivery_appt_end: at(3, 12),
    carrier_code: 'TPF', truck_id: '', driver_name: '', trailer: 'Dry Van', po_number: '', carrier_rate: '',
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = k => e => setF(v => ({ ...v, [k]: e.target.value }));

  async function book(e) {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      const s = await api.post(`/api/orders/${o.id}/book`, {
        ...f,
        pickup_appt_start: fromPhxInput(f.pickup_appt_start), pickup_appt_end: fromPhxInput(f.pickup_appt_end),
        delivery_appt_start: fromPhxInput(f.delivery_appt_start), delivery_appt_end: fromPhxInput(f.delivery_appt_end),
        po_number: f.po_number || undefined, carrier_rate: f.carrier_rate ? Number(f.carrier_rate) : undefined,
        author: getSession()?.name,
      }, { auth: true });
      navigate(`/tms/ops/shipments/${s.id}`);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  const field = (k, label, extra = {}) => (
    <div className="tms-field">
      <label htmlFor={`bk-${k}`}>{label}</label>
      <input id={`bk-${k}`} value={f[k]} onChange={set(k)} {...extra} />
    </div>
  );

  return (
    <form onSubmit={book}>
      <p className="tms-sub" style={{ marginBottom: 12 }}>Creates a shipment at the quoted price of {o.quote}. Times are Phoenix time.</p>
      <div className="tms-form-grid tms-form-grid-2">
        {field('origin', 'Pickup city', { required: true, placeholder: 'Phoenix, AZ' })}
        {field('destination', 'Delivery city', { required: true, placeholder: 'Dallas, TX' })}
        {field('pickup_appt_start', 'Pickup window opens', { type: 'datetime-local', required: true })}
        {field('pickup_appt_end', 'Pickup window closes', { type: 'datetime-local', required: true })}
        {field('delivery_appt_start', 'Delivery window opens', { type: 'datetime-local', required: true })}
        {field('delivery_appt_end', 'Delivery window closes', { type: 'datetime-local', required: true })}
        <div className="tms-field" style={{ gridColumn: '1 / -1' }}>
          <label htmlFor="bk-carrier_code">Carrier</label>
          <select id="bk-carrier_code" value={f.carrier_code} onChange={set('carrier_code')}>
            {(carriers.data || []).map(c => (
              <option key={c.code} value={c.code} disabled={c.status !== 'Active'}>{c.name}{c.status !== 'Active' ? ` (${c.status})` : ''}</option>
            ))}
          </select>
        </div>
        {field('truck_id', 'Truck', { required: true, list: 'bk-trucks' })}
        {field('driver_name', 'Driver', { required: true, list: 'bk-drivers' })}
        <datalist id="bk-trucks">{(trucks.data || []).filter(t => t.status === 'In service').map(t => <option key={t.id} value={t.id} />)}</datalist>
        <datalist id="bk-drivers">{(drivers.data || []).map(d => <option key={d.id} value={d.name} />)}</datalist>
        {field('trailer', 'Equipment', { list: 'bk-equip' })}
        <datalist id="bk-equip">{['Dry Van', 'Reefer', 'Flatbed', 'Step Deck'].map(t => <option key={t} value={t} />)}</datalist>
        {field('po_number', 'Customer PO')}
        {field('carrier_rate', 'Carrier pay (USD)', { type: 'number', step: '0.01', min: '0' })}
      </div>
      <button className="tms-btn" disabled={saving}>{saving ? 'Booking' : 'Book shipment'}</button>
      <ErrorNote error={error} />
    </form>
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
        <OrderState o={o} />
        <LiveNote live={live} />
      </PageHeader>
      <div className="tms-grid-2">
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
        <section className="tms-panel">
          <div className="tms-panel-h"><h2>Booking</h2></div>
          <div className="tms-panel-b">
            {o.shipment_id
              ? <p>Booked as shipment <Link className="tms-id" to={`/tms/ops/shipments/${o.shipment_id}`}>{o.shipment_id}</Link>.</p>
              : o.quote_status === 'Quote pending'
                ? <p className="tms-sub">This order needs a quote before it can be booked. Ask the customer for any missing details in Notes.</p>
                : <BookShipment o={o} />}
          </div>
        </section>
      </div>
    </>
  );
}
