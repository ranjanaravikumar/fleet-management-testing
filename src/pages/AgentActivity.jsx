import { Bot, CircleCheck, Database, Hand, Mail, PencilLine, Send, Truck } from 'lucide-react';
import { useFreshIds, useLiveData, useNow } from '../hooks/useLiveData';
import { TMS_API_URL, fmtDateTime, timeAgo } from '../api/tms';

// What each note action means, in words the operations team uses.
const ACTIONS = {
  milestone:        { label: 'Milestone recorded',   icon: CircleCheck, tone: 'green' },
  update:           { label: 'Record updated',       icon: PencilLine,  tone: 'blue' },
  email_received:   { label: 'Email received',       icon: Mail,        tone: 'muted' },
  asked_carrier:    { label: 'Asked the carrier',    icon: Truck,       tone: 'amber' },
  asked_customer:   { label: 'Asked the customer',   icon: Send,        tone: 'amber' },
  replied_customer: { label: 'Replied to customer',  icon: Send,        tone: 'green' },
  handoff:          { label: 'Handed to a person',   icon: Hand,        tone: 'red' },
  data_sweep:       { label: 'Data sweep',           icon: Database,    tone: 'blue' },
};

const RECOMMENDATION = {
  ask_carrier:    { label: 'Ask the carrier',      tone: 'amber' },
  fix_internally: { label: 'Fix from TMS records', tone: 'blue' },
  needs_human:    { label: 'Needs a person',       tone: 'red' },
};

const WAITING = {
  awaiting_carrier:  'Waiting on carrier reply',
  awaiting_customer: 'Waiting on customer reply',
  needs_human:       'With a person',
  resolved:          'Resolved',
};

function actionInfo(action) {
  return ACTIONS[action] || {
    label: action.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()),
    icon: Bot,
    tone: 'muted',
  };
}

function LiveIndicator({ error, updatedAt, now }) {
  if (error && !updatedAt) return <span className="live-pill off">Not connected</span>;
  if (error) return <span className="live-pill off">Connection lost, retrying</span>;
  if (!updatedAt) return <span className="live-pill">Connecting</span>;
  return <span className="live-pill on">Live, updated {timeAgo(new Date(updatedAt).toISOString(), now)}</span>;
}

export default function AgentActivity() {
  const notes = useLiveData('/api/notes?limit=100', 3000);
  const stats = useLiveData('/api/stats', 5000);
  const now = useNow(1000);

  // Highlight entries that arrive while the page is open (not the ones already there).
  const fresh = useFreshIds(notes.data);

  const s = stats.data;
  const waitingCarrier = (s?.shipments_by_agent_status?.awaiting_carrier || 0);
  const waitingCustomer = (s?.shipments_by_agent_status?.awaiting_customer || 0) +
                          (s?.orders_by_agent_status?.awaiting_customer || 0);
  const withPerson = (s?.shipments_by_agent_status?.needs_human || 0) +
                     (s?.orders_by_agent_status?.needs_human || 0);
  const dq = s?.order_data_quality || {};

  const offline = notes.error && !notes.data;

  return (
    <div className="animate-fade">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="s-tag">SMART API Agent</div>
          <h2>Agent activity</h2>
          <p className="small" style={{ marginTop: 6 }}>Every change the agent makes in the TMS, as it happens.</p>
        </div>
        <LiveIndicator error={notes.error} updatedAt={notes.updatedAt} now={now} />
      </div>

      {offline && (
        <div className="glass-card agent-offline">
          <strong>Can't reach the TMS API at {TMS_API_URL}.</strong>
          <p className="small">Start the backend from the project folder with
            <code> uvicorn backend.main:app --reload --port 8000</code>, or set VITE_TMS_API_URL in
            .env.local to the ngrok or hosted address. This page reconnects on its own.</p>
        </div>
      )}

      <div className="stat-row agent-stats">
        <div className="stat-card"><h3>Actions logged</h3><div className="val">{s?.notes_total ?? '–'}</div></div>
        <div className="stat-card"><h3>Shipments updated</h3><div className="val">{s?.shipments_updated ?? '–'}</div></div>
        <div className="stat-card"><h3>Waiting on carrier</h3><div className="val">{s ? waitingCarrier : '–'}</div></div>
        <div className="stat-card"><h3>Waiting on customer</h3><div className="val">{s ? waitingCustomer : '–'}</div></div>
        <div className="stat-card"><h3>With a person</h3><div className="val">{s ? withPerson : '–'}</div></div>
      </div>

      <div className="agent-grid">
        {/* Feed */}
        <section className="glass-card agent-feed" aria-live="polite">
          <h3 className="agent-h3">Activity</h3>
          {notes.data && notes.data.length === 0 && (
            <p className="small agent-empty">
              No agent activity yet. Email the agent's inbox about a shipment, or record a change
              from the API docs, and it appears here within a few seconds.
            </p>
          )}
          <ol className="agent-list">
            {(notes.data || []).map(n => {
              const info = actionInfo(n.action);
              const Icon = info.icon;
              return (
                <li key={n.id} className={`agent-item${fresh.has(n.id) ? ' fresh' : ''}`}>
                  <span className={`agent-icon tone-${info.tone}`}><Icon size={15} strokeWidth={2.2} /></span>
                  <div className="agent-body">
                    <div className="agent-line">
                      <span className="agent-action">{info.label}</span>
                      <span className="agent-record">{n.entity_id}</span>
                      <time className="agent-time" dateTime={n.created_at} title={fmtDateTime(n.created_at)}>
                        {timeAgo(n.created_at, now)}
                      </time>
                    </div>
                    <p className="agent-msg">{n.message}</p>
                    {n.source_ref && <p className="agent-ref">From email: {n.source_ref}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>

        <div className="agent-side">
          {/* Open exceptions */}
          <section className="glass-card">
            <h3 className="agent-h3">Shipments needing action</h3>
            {s && s.open_exceptions.length === 0 && (
              <p className="small">Nothing open. Every active shipment is on track.</p>
            )}
            <ul className="agent-exc">
              {(s?.open_exceptions || []).map(e => {
                const rec = RECOMMENDATION[e.recommendation] || { label: e.recommendation, tone: 'muted' };
                return (
                  <li key={e.shipment_id}>
                    <div className="agent-line">
                      <span className="agent-record">{e.shipment_id}</span>
                      <span className={`agent-chip tone-${rec.tone}`}>{rec.label}</span>
                    </div>
                    <p className="small">{e.route}</p>
                    <p className="agent-msg">{e.summary}</p>
                    {e.agent_status && <p className="agent-ref">{WAITING[e.agent_status]}</p>}
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Order data quality */}
          <section className="glass-card">
            <h3 className="agent-h3">Order data quality</h3>
            <p className="small" style={{ marginBottom: 12 }}>Problems found across all orders.</p>
            <dl className="agent-dq">
              <div><dt>Safe to fix automatically</dt><dd>{s ? (dq.auto || 0) : '–'}</dd></div>
              <div><dt>Need the customer</dt><dd>{s ? (dq.ask_customer || 0) : '–'}</dd></div>
              <div><dt>Need a person</dt><dd>{s ? (dq.needs_human || 0) : '–'}</dd></div>
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}
