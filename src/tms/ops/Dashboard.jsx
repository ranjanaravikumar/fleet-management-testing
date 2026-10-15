import { Link } from 'react-router-dom';
import { useLiveData } from '../../hooks/useLiveData';
import { fmtDateTime, fmtTime } from '../../api/tms';
import { ApiDown, LiveNote, PageHeader, ShipmentStatus } from '../ui';
import { NOTE_ACTION, insuranceState, money, phxDay, todayPhx } from '../lib';

const RECORD_PATH = { shipment: 'shipments', order: 'orders', customer: 'customers', carrier: 'carriers' };

function recordLink(type, id) {
  const base = RECORD_PATH[type];
  return base ? <Link className="tms-id" to={`/tms/ops/${base}/${id}`}>{id}</Link> : id;
}

/** Everything that needs a person today, most urgent first. */
function attentionItems(ships, customers, carriers, trucks) {
  const items = [];
  const active = ships.filter(s => s.status !== 'Delivered');
  for (const s of active.filter(x => x.tracking_alert)) {
    items.push({ key: `a-${s.id}`, level: 'bad', what: s.tracking_alert, link: recordLink('shipment', s.id),
                 detail: `${s.origin} to ${s.destination}, ${s.carrier_name}` });
  }
  for (const s of active.filter(x => !x.truck_id || !x.driver_name)) {
    items.push({ key: `t-${s.id}`, level: 'warn', what: 'No truck or driver', link: recordLink('shipment', s.id),
                 detail: `${s.origin} to ${s.destination}` });
  }
  for (const c of customers.filter(x => x.on_hold && x.active_shipments > 0)) {
    items.push({ key: `c-${c.code}`, level: 'warn', what: 'Account on hold with freight moving', link: recordLink('customer', c.code),
                 detail: `${c.name}: ${c.hold_reason || 'no reason recorded'}` });
  }
  for (const c of carriers) {
    const ins = insuranceState(c.insurance_days_left);
    if (ins.cls !== 'tms-s-ok' && (c.status === 'Active' || c.active_shipments > 0)) {
      items.push({ key: `i-${c.code}`, level: ins.cls === 'tms-s-bad' ? 'bad' : 'warn', what: `Carrier insurance ${ins.label.toLowerCase()}`,
                   link: recordLink('carrier', c.code), detail: c.name });
    }
  }
  for (const t of trucks.filter(x => x.status !== 'In service')) {
    items.push({ key: `k-${t.id}`, level: 'warn', what: `${t.id} ${t.status.toLowerCase()}`,
                 link: <Link className="tms-id" to="/tms/ops/fleet">Fleet</Link>, detail: t.issue || '' });
  }
  return items;
}

function todaysStops(ships) {
  const today = todayPhx();
  const stops = [];
  for (const s of ships) {
    const done = code => s.milestones?.some(m => m.code === code);
    if (phxDay(s.pickup_appt_start) === today) stops.push({ s, kind: 'Pickup', at: s.pickup_appt_start, place: s.origin, done: done('PICK') });
    if (phxDay(s.delivery_appt_start) === today) stops.push({ s, kind: 'Delivery', at: s.delivery_appt_start, place: s.destination, done: done('DELV') });
  }
  return stops.sort((a, b) => a.at.localeCompare(b.at));
}

export function OpsDashboard() {
  const ships = useLiveData('/api/shipments', 5000);
  const customers = useLiveData('/api/customers', 30000);
  const carriers = useLiveData('/api/carriers', 30000);
  const trucks = useLiveData('/api/trucks', 30000);
  const orders = useLiveData('/api/orders?source=portal&limit=200', 15000);
  const notes = useLiveData('/api/notes?limit=15', 5000);

  const all = ships.data || [];
  const active = all.filter(s => s.status !== 'Delivered');
  const toInvoice = all.filter(s => s.status === 'Delivered' && s.invoice_status === 'Not invoiced');
  const stops = todaysStops(all);
  const attention = attentionItems(all, customers.data || [], carriers.data || [], trucks.data || []);
  const openQuotes = (orders.data?.items || []).filter(o => !o.shipment_id && o.quote_status === 'Quote pending').length;
  const dateLabel = new Date().toLocaleDateString('en-US', { timeZone: 'America/Phoenix', weekday: 'long', month: 'long', day: 'numeric' });
  const n = v => (ships.data ? v : '–');

  return (
    <>
      <PageHeader title="Today" subtitle={`${dateLabel}, Phoenix time`}>
        <LiveNote live={ships} />
      </PageHeader>
      <ApiDown live={ships} />
      <dl className="tms-metrics">
        <div className="tms-metric"><dt>Active shipments</dt><dd>{n(active.length)}</dd></div>
        <div className="tms-metric"><dt>Exceptions</dt><dd className={active.some(s => s.tracking_alert) ? 'tms-bad' : ''}>{n(active.filter(s => s.tracking_alert).length)}</dd></div>
        <div className="tms-metric"><dt>Pickups today</dt><dd>{n(stops.filter(x => x.kind === 'Pickup').length)}</dd></div>
        <div className="tms-metric"><dt>Deliveries today</dt><dd>{n(stops.filter(x => x.kind === 'Delivery').length)}</dd></div>
        <div className="tms-metric"><dt>Ready to invoice</dt><dd>{n(toInvoice.length)}
          {toInvoice.length > 0 && <small> {money(toInvoice.reduce((t, s) => t + (Number(String(s.amount).replace(/[^\d.]/g, '')) || 0), 0))}</small>}</dd></div>
        <div className="tms-metric"><dt>Quote requests waiting</dt><dd>{orders.data ? openQuotes : '–'}</dd></div>
      </dl>

      <div className="tms-grid-2">
        <div className="tms-stack">
          <section className="tms-panel">
            <div className="tms-panel-h"><h2>Needs attention</h2><span className="tms-sub">{attention.length} items</span></div>
            {attention.length === 0
              ? <p className="tms-empty">Nothing needs a person right now.</p>
              : (
                <ul className="tms-attn">
                  {attention.map(i => (
                    <li key={i.key} className={i.level}>
                      <span className="tms-attn-mark" aria-hidden="true" />
                      <div><strong>{i.what}</strong><div className="tms-sub">{i.detail}</div></div>
                      <div>{i.link}</div>
                    </li>
                  ))}
                </ul>
              )}
          </section>
          <section className="tms-panel" style={{ overflowX: 'auto' }}>
            <div className="tms-panel-h"><h2>Today's pickups and deliveries</h2><Link to="/tms/ops/dispatch">Dispatch board</Link></div>
            {stops.length === 0
              ? <p className="tms-empty">No pickups or deliveries scheduled today.</p>
              : (
                <table className="tms-table">
                  <thead><tr><th>Appointment</th><th>Stop</th><th>Shipment</th><th>Place</th><th>Status</th></tr></thead>
                  <tbody>
                    {stops.map(x => (
                      <tr key={`${x.s.id}-${x.kind}`}>
                        <td>{fmtTime(x.at)}</td>
                        <td>{x.kind}{x.done && <div className="tms-inline-note ok">Done</div>}</td>
                        <td>{recordLink('shipment', x.s.id)}<div className="tms-sub">{x.s.carrier_name}</div></td>
                        <td>{x.place}</td>
                        <td><ShipmentStatus status={x.s.status} />{x.s.tracking_alert && <div className="tms-inline-note warn">{x.s.tracking_alert}</div>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
          </section>
        </div>

        <section className="tms-panel">
          <div className="tms-panel-h"><h2>Recent activity</h2></div>
          <ul className="tms-feed tms-feed-2">
            {(notes.data || []).map(nt => (
              <li key={nt.id}>
                <span className="tms-feed-time" title={fmtDateTime(nt.created_at)}>{fmtTime(nt.created_at)}</span>
                <div>
                  <div className="tms-msg-who">{recordLink(nt.entity_type, nt.entity_id)}
                    <span className="tms-msg-tag plain">{NOTE_ACTION[nt.action] || nt.action}</span></div>
                  <p className="tms-feed-text">{nt.message}</p>
                  <div className="tms-feed-ref">{nt.author}</div>
                </div>
              </li>
            ))}
          </ul>
          {notes.data && notes.data.length === 0 && <p className="tms-empty">No activity yet.</p>}
        </section>
      </div>
    </>
  );
}
