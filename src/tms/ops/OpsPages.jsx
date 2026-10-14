import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useFreshIds, useLiveData, useNow } from '../../hooks/useLiveData';
import { fmtDateTime, fmtWindow, timeAgo } from '../../api/tms';
import { ApiDown, CaseStatus, CaseThread, LiveNote, PageHeader, ShipmentStatus, Timeline } from '../ui';
import { NOTE_ACTION, RECOMMENDATION, api, getSession } from '../lib';

function Recommendation({ rec }) {
  const r = RECOMMENDATION[rec] || { label: rec, tone: 'tms-s-muted' };
  return <span className={`tms-status ${r.tone}`}>{r.label}</span>;
}

// ── Shipments ────────────────────────────────────────────────────────

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'action', label: 'Needs action' },
  { id: 'transit', label: 'Active' },
  { id: 'delivered', label: 'Delivered' },
];

export function OpsShipments() {
  const ships = useLiveData('/api/shipments', 3000);
  const stats = useLiveData('/api/stats', 4000);
  const cases = useLiveData('/api/cases?status=open', 3000);
  const [filter, setFilter] = useState('all');
  const navigate = useNavigate();

  const exc = Object.fromEntries((stats.data?.open_exceptions || []).map(e => [e.shipment_id, e]));
  const caseFor = Object.fromEntries((cases.data || []).filter(c => c.shipment_id).map(c => [c.shipment_id, c]));
  const all = ships.data || [];
  const rows = all.filter(s =>
    filter === 'all' ? true
      : filter === 'action' ? Boolean(exc[s.id] || caseFor[s.id])
        : filter === 'transit' ? s.status !== 'Delivered' : s.status === 'Delivered');

  const active = all.filter(s => s.status !== 'Delivered').length;
  const waitingCarrier = (cases.data || []).filter(c => c.status === 'awaiting_carrier').length;

  return (
    <>
      <PageHeader title="Shipments" subtitle="All shipments, with problems the agent has found or is working on.">
        <LiveNote live={ships} />
      </PageHeader>
      <ApiDown live={ships} />
      <dl className="tms-metrics">
        <div className="tms-metric"><dt>Active shipments</dt><dd>{ships.data ? active : '–'}</dd></div>
        <div className="tms-metric"><dt>Need action</dt><dd>{stats.data ? Object.keys(exc).length : '–'}</dd></div>
        <div className="tms-metric"><dt>Open cases</dt><dd>{cases.data ? cases.data.length : '–'}</dd></div>
        <div className="tms-metric"><dt>Waiting on carrier</dt><dd>{cases.data ? waitingCarrier : '–'}</dd></div>
      </dl>
      <div className="tms-panel" style={{ overflowX: 'auto' }}>
        <div className="tms-panel-h">
          <div className="tms-filters" role="group" aria-label="Filter shipments">
            {FILTERS.map(f => (
              <button key={f.id} className={filter === f.id ? 'on' : ''} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>{f.label}</button>
            ))}
          </div>
          <span className="tms-sub">{rows.length} shown</span>
        </div>
        <table className="tms-table">
          <thead>
            <tr><th>Shipment</th><th>Customer</th><th>Route</th><th>Carrier</th><th>Status</th><th>Delivery appointment</th><th>Agent</th></tr>
          </thead>
          <tbody>
            {rows.map(s => (
              <tr key={s.id} className="click" onClick={() => navigate(`/tms/ops/shipments/${s.id}`)}>
                <td><Link className="tms-id" to={`/tms/ops/shipments/${s.id}`} onClick={e => e.stopPropagation()}>{s.id}</Link><div className="tms-sub">{s.bol}</div></td>
                <td>{s.customer_name || s.customer_code}</td>
                <td>{s.origin} to {s.destination}</td>
                <td>{s.carrier_name}<div className="tms-sub">{s.truck_id || 'No truck assigned'}</div></td>
                <td><ShipmentStatus status={s.status} /></td>
                <td>{fmtWindow(s.delivery_appt_start, s.delivery_appt_end)}</td>
                <td>
                  {caseFor[s.id] ? <CaseStatus status={caseFor[s.id].status} />
                    : exc[s.id] ? <Recommendation rec={exc[s.id].recommendation} />
                      : <span className="tms-sub">On track</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {ships.data && rows.length === 0 && <p className="tms-empty">No shipments match this filter.</p>}
      </div>
    </>
  );
}

// ── Shipment detail ──────────────────────────────────────────────────

export function OpsShipment() {
  const { id } = useParams();
  const ship = useLiveData(`/api/shipments/${encodeURIComponent(id)}`, 3000);
  const check = useLiveData(`/api/agent-tools/shipments/${encodeURIComponent(id)}/check`, 4000);
  const cases = useLiveData(`/api/cases?shipment_id=${encodeURIComponent(id)}`, 3000);
  const [tab, setTab] = useState('tracking');
  const now = useNow(10000);
  const s = ship.data;

  if (ship.error && !s) {
    return <PageHeader crumb={<Link to="/tms/ops/shipments">Shipments</Link>} title={id} subtitle="Couldn't load this shipment." />;
  }
  if (!s) return <p className="tms-empty">Loading shipment</p>;
  const c = check.data;
  const alert = c?.overdue_milestones?.length ? 'late' : null;
  const openCases = (cases.data || []).filter(x => x.status !== 'resolved');
  const TABS = [
    { id: 'tracking', label: 'Tracking' },
    { id: 'cases', label: `Cases (${(cases.data || []).length})` },
    { id: 'activity', label: `Activity (${s.notes.length})` },
  ];

  return (
    <>
      <PageHeader crumb={<Link to="/tms/ops/shipments">Shipments</Link>} title={s.id}
                  subtitle={`${s.origin} to ${s.destination}, ${s.customer?.name || s.customer_code}`}>
        <ShipmentStatus status={s.status} />
        <LiveNote live={ship} />
      </PageHeader>
      <div className="tms-grid-2">
        <div className="tms-panel">
          <div className="tms-tabs" style={{ padding: '0 6px', borderRadius: '6px 6px 0 0' }} role="tablist">
            {TABS.map(t => (
              <a key={t.id} role="tab" aria-selected={tab === t.id} href={`#${t.id}`} className={tab === t.id ? 'active' : ''}
                 onClick={e => { e.preventDefault(); setTab(t.id); }}>{t.label}</a>
            ))}
          </div>
          <div className="tms-panel-b">
            {tab === 'tracking' && <Timeline shipment={s} alert={alert} />}
            {tab === 'cases' && ((cases.data || []).length === 0
              ? <p className="tms-sub">No customer cases on this shipment.</p>
              : (cases.data || []).map(cs => (
                <div key={cs.id} style={{ marginBottom: 18 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 4 }}>
                    <strong>{cs.id}: {cs.category_label}</strong>
                    <span><CaseStatus status={cs.status} /> <span className="tms-sub">via {cs.channel}</span></span>
                  </div>
                  <CaseThread caseData={cs} perspective="ops" onChange={cases.reload} />
                </div>
              )))}
            {tab === 'activity' && (s.notes.length === 0
              ? <p className="tms-sub">No changes recorded yet.</p>
              : (
                <ul className="tms-feed" style={{ margin: '-14px' }}>
                  {s.notes.map(n => (
                    <li key={n.id}>
                      <span className="tms-feed-time" title={fmtDateTime(n.created_at)}>{timeAgo(n.created_at, now)}</span>
                      <span>{NOTE_ACTION[n.action] || n.action}</span>
                      <div>{n.message}{n.source_ref && <div className="tms-feed-ref">Re: {n.source_ref}</div>}</div>
                    </li>
                  ))}
                </ul>
              ))}
          </div>
        </div>

        <div className="tms-stack">
          <section className="tms-panel">
            <div className="tms-panel-h"><h2>Agent check</h2>{c && <Recommendation rec={c.recommendation} />}</div>
            <div className="tms-panel-b">
              {!c ? <p className="tms-sub">Checking</p> : (
                <>
                  <p>{c.summary}</p>
                  {c.internal_fixes.map(f => (
                    <p key={f.field} className="tms-sub" style={{ marginTop: 6 }}>{f.evidence}</p>
                  ))}
                  {c.guardrails.map(g => (
                    <div key={g.flag} className="tms-callout bad" style={{ marginTop: 8 }}>{g.reason}</div>
                  ))}
                  {openCases.length > 0 && (
                    <p className="tms-sub" style={{ marginTop: 10 }}>
                      Open case: {openCases.map(x => x.id).join(', ')}. See the Cases tab.
                    </p>
                  )}
                </>
              )}
            </div>
          </section>
          <section className="tms-panel">
            <div className="tms-panel-h"><h2>Details</h2></div>
            <dl className="tms-panel-b tms-kv">
              <div><dt>Customer</dt><dd>{s.customer?.name}</dd></div>
              <div><dt>Account</dt><dd>{s.customer?.on_hold ? <span className="tms-status tms-s-bad">On hold</span> : 'In good standing'}</dd></div>
              <div><dt>Carrier</dt><dd>{s.carrier_name}</dd></div>
              <div><dt>BOL</dt><dd>{s.bol}</dd></div>
              <div><dt>Truck</dt><dd>{s.truck_id || 'Not assigned'}</dd></div>
              <div><dt>Driver</dt><dd>{s.driver_name || 'Not assigned'}</dd></div>
              <div><dt>Load</dt><dd>{s.load_id || 'None'}</dd></div>
              <div><dt>Value</dt><dd>{s.amount}</dd></div>
              <div><dt>Pickup appointment</dt><dd>{fmtWindow(s.pickup_appt_start, s.pickup_appt_end)}</dd></div>
              <div><dt>Delivery appointment</dt><dd>{fmtWindow(s.delivery_appt_start, s.delivery_appt_end)}</dd></div>
            </dl>
          </section>
        </div>
      </div>
    </>
  );
}

// ── Cases queue ──────────────────────────────────────────────────────

export function OpsCases() {
  const [show, setShow] = useState('open');
  const list = useLiveData(`/api/cases?status=${show === 'open' ? 'open' : 'resolved'}`, 3000);
  const [params, setParams] = useSearchParams();
  const fresh = useFreshIds(list.data);
  const now = useNow(10000);
  const rows = list.data || [];
  const selected = rows.find(c => c.id === params.get('case')) || rows[0];

  return (
    <>
      <PageHeader title="Cases" subtitle="Customer requests from every channel. The agent works them; you handle what it hands over.">
        <LiveNote live={list} />
      </PageHeader>
      <ApiDown live={list} />
      <div className="tms-grid-2">
        <div className="tms-panel" style={{ overflowX: 'auto' }}>
          <div className="tms-panel-h">
            <div className="tms-filters" role="group" aria-label="Show cases">
              <button className={show === 'open' ? 'on' : ''} aria-pressed={show === 'open'} onClick={() => setShow('open')}>Open</button>
              <button className={show === 'resolved' ? 'on' : ''} aria-pressed={show === 'resolved'} onClick={() => setShow('resolved')}>Resolved</button>
            </div>
            <span className="tms-sub">{rows.length} cases</span>
          </div>
          <table className="tms-table">
            <thead><tr><th>Case</th><th>Request</th><th>Status</th><th>Updated</th></tr></thead>
            <tbody>
              {rows.map(cs => (
                <tr key={cs.id} className={`click${fresh.has(cs.id) ? ' fresh' : ''}`} onClick={() => setParams({ case: cs.id })}
                    style={selected?.id === cs.id ? { background: 'var(--brand-bg)' } : undefined}>
                  <td><span className="tms-id">{cs.id}</span><div className="tms-sub">{cs.shipment_id || cs.order_id}, {cs.customer_name || cs.customer_code}</div></td>
                  <td>{cs.category_label}<div className="tms-sub">via {cs.channel}</div></td>
                  <td><CaseStatus status={cs.status} /></td>
                  <td className="tms-sub">{timeAgo(cs.updated_at, now)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.data && rows.length === 0 && (
            <p className="tms-empty">{show === 'open' ? 'No open cases. New customer requests appear here within seconds.' : 'No resolved cases yet.'}</p>
          )}
        </div>
        <section className="tms-panel">
          {selected ? (
            <>
              <div className="tms-panel-h">
                <h2>{selected.id}: {selected.category_label}</h2>
                <CaseStatus status={selected.status} />
              </div>
              <div className="tms-panel-b">
                <p className="tms-sub" style={{ marginBottom: 8 }}>
                  {selected.shipment_id
                    ? <Link to={`/tms/ops/shipments/${selected.shipment_id}`}>Shipment {selected.shipment_id}</Link>
                    : <>Order {selected.order_id}</>}
                  {', '}{selected.customer_name || selected.customer_code}, via {selected.channel}{selected.sender_email ? ` from ${selected.sender_email}` : ''}
                </p>
                <CaseThread caseData={selected} perspective="ops" onChange={list.reload} />
              </div>
            </>
          ) : <p className="tms-empty">Select a case to see the conversation.</p>}
        </section>
      </div>
    </>
  );
}

// ── Orders and data quality ──────────────────────────────────────────

const CLASS_LABEL = {
  suggested: { label: 'Suggested, needs approval', tone: 'tms-s-agent' },
  auto: { label: 'Safe to fix automatically', tone: 'tms-s-info' },
  ask_customer: { label: 'Needs the customer', tone: 'tms-s-warn' },
  needs_human: { label: 'Needs a person', tone: 'tms-s-bad' },
  info: { label: 'For information', tone: 'tms-s-muted' },
};

// Fields a person can approve a suggested value for.
const APPROVABLE = new Set(['origin_country', 'dest_country', 'origin_zip', 'dest_zip', 'origin_state',
  'dest_state', 'weight_lbs', 'pallet_count', 'skid_dims', 'freight_class']);
const GROUPS = ['suggested', 'needs_human', 'ask_customer', 'auto', 'info'];

export function OpsOrders() {
  const dq = useLiveData('/api/agent-tools/orders/data-quality', 5000);
  const [cls, setCls] = useState('suggested');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const by = dq.data?.by_fix_class || {};
  const issues = (dq.data?.issues || []).filter(i => i.fix_class === cls);
  const canApprove = i => (i.fix_class === 'suggested' || i.fix_class === 'needs_human')
    && i.suggested != null && APPROVABLE.has(i.field);

  async function approve(i) {
    const key = `${i.order_id}-${i.field}`;
    setBusy(key); setError('');
    try {
      await api.post(`/api/orders/${i.order_id}/approve-fix`,
        { field: i.field, value: i.suggested, approved_by: getSession()?.name || 'Operations' }, { auth: true });
      dq.reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  }

  return (
    <>
      <PageHeader title="Orders" subtitle={dq.data ? `${dq.data.orders_checked} orders checked, ${dq.data.orders_with_issues} with problems.` : ' '}>
        <LiveNote live={dq} />
      </PageHeader>
      <ApiDown live={dq} />
      {error && <div className="tms-error" role="alert">{error}</div>}
      <dl className="tms-metrics">
        {GROUPS.map(k => (
          <div key={k} className="tms-metric"><dt>{CLASS_LABEL[k].label}</dt><dd>{dq.data ? (by[k] || 0) : '–'}</dd></div>
        ))}
      </dl>
      <div className="tms-panel" style={{ overflowX: 'auto' }}>
        <div className="tms-panel-h">
          <div className="tms-filters" role="group" aria-label="Show problems">
            {GROUPS.map(k => (
              <button key={k} className={cls === k ? 'on' : ''} aria-pressed={cls === k} onClick={() => setCls(k)}>{CLASS_LABEL[k].label}</button>
            ))}
          </div>
          <span className="tms-sub">{issues.length} problems</span>
        </div>
        <table className="tms-table">
          <thead><tr><th>Order</th><th>Field</th><th>Problem</th><th>Current value</th><th>Suggested</th><th /></tr></thead>
          <tbody>
            {issues.slice(0, 150).map((i, n) => (
              <tr key={`${i.order_id}-${i.field}-${n}`}>
                <td className="tms-id">{i.order_id}</td>
                <td>{i.field}</td>
                <td>{i.problem}</td>
                <td>{i.current === '' ? <span className="tms-sub">empty</span> : i.current}</td>
                <td>{i.suggested ?? <span className="tms-sub">None</span>}</td>
                <td>
                  {canApprove(i) && (
                    <button className="tms-btn small secondary" disabled={busy === `${i.order_id}-${i.field}`}
                            onClick={() => approve(i)}>Approve</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {dq.data && issues.length === 0 && <p className="tms-empty">None left in this group.</p>}
      </div>
    </>
  );
}

// ── Agent activity ───────────────────────────────────────────────────

export function OpsActivity() {
  const notes = useLiveData('/api/notes?limit=100', 3000);
  const fresh = useFreshIds(notes.data);
  const now = useNow(5000);
  const rows = notes.data || [];
  return (
    <>
      <PageHeader title="Agent activity" subtitle="Every change made in the TMS, newest first.">
        <LiveNote live={notes} />
      </PageHeader>
      <ApiDown live={notes} />
      <div className="tms-panel">
        {notes.data && rows.length === 0 && (
          <p className="tms-empty">Nothing yet. Open a case from the customer portal and the agent's work appears here.</p>
        )}
        <ul className="tms-feed">
          {rows.map(n => (
            <li key={n.id} className={fresh.has(n.id) ? 'fresh' : ''}>
              <span className="tms-feed-time" title={fmtDateTime(n.created_at)}>{timeAgo(n.created_at, now)}</span>
              <span>
                <strong style={{ fontWeight: 600 }}>{n.entity_id}</strong>
                <div className="tms-sub">{NOTE_ACTION[n.action] || n.action}</div>
              </span>
              <div>
                {n.message}
                <div className="tms-feed-ref">{n.author}{n.source_ref ? `, re: ${n.source_ref}` : ''}</div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
