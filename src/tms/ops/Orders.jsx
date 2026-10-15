import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveData } from '../../hooks/useLiveData';
import { fmtDate } from '../../api/tms';
import { ApiDown, ErrorNote, LiveNote, NotesPanel, PageHeader, RecordTabs } from '../ui';
import { DataGrid } from '../grid';
import { api, fromPhxInput, getSession, lane, money, toPhxInput, weight } from '../lib';
import { OrderDetails, QuoteStatus } from '../portal/PortalPages';

const quoted = o => o.quote_status !== 'Quote pending';

function OrderState({ o }) {
  if (o.shipment_id) return <span className="tms-status tms-s-ok">Booked</span>;
  return <QuoteStatus order={o} />;
}

export function OpsOrders() {
  const live = useLiveData('/api/orders?limit=500', 5000);
  const navigate = useNavigate();
  const all = useMemo(() => live.data?.items || [], [live.data]);

  const tabs = useMemo(() => [
    { id: 'all', label: 'All', test: () => true },
    { id: 'portal', label: 'Quote requests', test: o => o.source === 'portal' },
    { id: 'pending', label: 'Needs a quote', test: o => !quoted(o) && !o.shipment_id },
    { id: 'ready', label: 'Quoted, not booked', test: o => quoted(o) && !o.shipment_id },
    { id: 'booked', label: 'Booked', test: o => Boolean(o.shipment_id) },
  ], []);

  const columns = useMemo(() => [
    {
      id: 'id', label: 'Order', fixed: true, sortBy: o => o.id, csv: o => o.id,
      render: o => (
        <>
          <Link className="tms-id" to={`/tms/ops/orders/${o.id}`} onClick={e => e.stopPropagation()}>{o.id}</Link>
          {o.source === 'portal' && <div className="tms-sub">Quote request</div>}
          {o.shipment_id && <div className="tms-sub">Shipment {o.shipment_id}</div>}
        </>
      ),
    },
    { id: 'lane', label: 'Lane', sortBy: o => lane(o) },
    {
      id: 'weight', label: 'Weight', num: true,
      sortBy: o => Number(String(o.weight_lbs).replace(/[^\d.]/g, '')) || null,
      csv: o => o.weight_lbs, render: o => weight(o),
    },
    { id: 'class', label: 'Class', sortBy: o => Number(o.freight_class) || null, csv: o => o.freight_class, render: o => o.freight_class },
    { id: 'status', label: 'Order status', sortBy: o => o.status },
    {
      id: 'quote', label: 'Quote', sortBy: o => Number(String(o.quote).replace(/[^\d.]/g, '')) || null,
      csv: o => o.quote_status, render: o => <OrderState o={o} />,
    },
    { id: 'created', label: 'Created', sortBy: o => o.created_at, csv: o => o.created_at, render: o => fmtDate(o.created_at) },
    { id: 'commodity', label: 'Commodity', off: true, sortBy: o => o.commodity },
    { id: 'pallets', label: 'Pallets', off: true, num: true, sortBy: o => Number(o.pallet_count) || null },
  ], []);

  const search = useCallback(o => [
    o.id, o.origin_zip, o.origin_state, o.origin_country, o.dest_zip, o.dest_state, o.dest_country,
    o.commodity, o.status, o.freight_class, o.shipment_id,
  ], []);

  return (
    <>
      <PageHeader title="Orders" subtitle={live.data ? `${all.length} orders and quote requests` : ' '}>
        <Link className="tms-btn secondary small" to="/tms/ops/orders/new">New order</Link>
        <LiveNote live={live} />
      </PageHeader>
      <ApiDown live={live} />
      <DataGrid
        name="orders" live={live} rows={all} tabs={tabs} columns={columns} search={search}
        rowId={o => o.id} onOpen={o => navigate(`/tms/ops/orders/${o.id}`)}
        initialSort={{ key: 'created', dir: 'desc' }}
        csvName={tab => `orders-${tab}.csv`}
        empty="No orders match. Clear the search or pick another tab."
      />
    </>
  );
}

// ── Auto-rating ──────────────────────────────────────────────────────

function AutoRating({ o, onAccept }) {
  const live = useLiveData(`/api/orders/${encodeURIComponent(o.id)}/rating`, 0);
  const [override, setOverride] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const r = live.data;

  if (live.error) return null;
  if (!r) return <p className="tms-sub">Calculating suggested rate…</p>;

  async function accept(value) {
    setSaving(true); setError('');
    try {
      await api.patch(`/api/orders/${o.id}`, {
        quote: String(value),
        reason: value === r.suggested_rate
          ? `Auto-rate accepted: ${r.lane}, ${r.weight_lbs.toLocaleString()} lb.`
          : `Auto-rate overridden from ${money(r.suggested_rate)} to ${money(value)}.`,
        author: getSession()?.name,
      }, { auth: true });
      onAccept();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="tms-callout" style={{ marginBottom: 16 }}>
      <strong>Suggested rate: {money(r.suggested_rate)}</strong>
      <div className="tms-sub" style={{ marginTop: 4 }}>
        {r.lane}{r.lane_specific ? '' : ' (default lane)'} · {r.weight_lbs.toLocaleString()} lb
        ({r.weight_cwt} cwt) · ${r.rate_per_cwt}/cwt × {r.weight_multiplier} break
        = {money(r.linehaul)} linehaul + {money(r.fuel_surcharge)} FSC ({r.fuel_pct}%)
        {r.suggested_rate <= r.minimum_charge && ` · minimum charge applied`}
      </div>
      <div className="tms-actions" style={{ marginTop: 10 }}>
        <button className="tms-btn small" disabled={saving} onClick={() => accept(r.suggested_rate)}>
          Accept {money(r.suggested_rate)}
        </button>
        <input type="number" step="0.01" min="0" placeholder="Override amount"
               className="tms-searchbox" style={{ width: 160 }}
               value={override} onChange={e => setOverride(e.target.value)}
               aria-label="Override quote amount" />
        <button className="tms-btn secondary small" disabled={saving || !override || Number(override) <= 0}
                onClick={() => accept(Number(override))}>
          Set override
        </button>
      </div>
      <ErrorNote error={error} />
    </div>
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
                ? (
                  <>
                    {o.weight_lbs && <AutoRating o={o} onAccept={live.reload} />}
                    <p className="tms-sub">{o.weight_lbs ? 'Accept or override the suggested rate above, then book.' : 'This order needs a quote before it can be booked. Ask the customer for any missing details in Notes.'}</p>
                  </>
                )
                : <BookShipment o={o} />}
          </div>
        </section>
      </div>
    </>
  );
}
