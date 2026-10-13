import { useState } from 'react';
import { CaseThread } from '../ui';
import { HELP_TOPICS, PORTAL_CUSTOMER, api } from '../lib';

/**
 * The "Help with this shipment/order" side of a detail page.
 * kind: 'shipment' | 'order'. alert: a problem the TMS already sees, or null.
 */
export default function HelpPanel({ kind, recordId, alert, cases, onChange }) {
  const topics = HELP_TOPICS.filter(t => t.for === kind || t.for === 'both');
  const [topic, setTopic] = useState(topics[0].id);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const open = cases.filter(c => c.status !== 'resolved');
  const past = cases.filter(c => c.status === 'resolved');
  const alertHandled = open.some(c => c.category === 'status_update');

  async function openCase(category, text) {
    setSending(true); setError('');
    try {
      await api.post('/api/portal/cases', {
        customer_code: PORTAL_CUSTOMER,
        [kind === 'shipment' ? 'shipment_id' : 'order_id']: recordId,
        category, message: text || undefined,
      });
      setMessage('');
      onChange();
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="tms-stack">
      {alert && !alertHandled && (
        <div className="tms-panel">
          <div className="tms-panel-b">
            <div className="tms-callout warn" style={{ marginBottom: 12 }}>
              <div>
                <strong>{alert}.</strong>{' '}
                {alert.startsWith('Delivery')
                  ? "The delivery appointment has passed and the carrier hasn't confirmed arrival."
                  : "The pickup window has passed and the carrier hasn't confirmed pickup."}
              </div>
            </div>
            <button className="tms-btn" disabled={sending} onClick={() => openCase('status_update', null)}>
              Get an update
            </button>
          </div>
        </div>
      )}

      {open.map(c => (
        <section className="tms-panel" key={c.id} aria-label={`Case ${c.id}`}>
          <div className="tms-panel-h">
            <h2>{c.category_label}</h2>
            <span className="tms-sub">{c.id}</span>
          </div>
          <div className="tms-panel-b">
            <div className="tms-callout agent" style={{ marginBottom: 6 }}><strong>{c.customer_status}</strong></div>
            <CaseThread caseData={c} perspective="customer" onChange={onChange} />
          </div>
        </section>
      ))}

      <section className="tms-panel">
        <div className="tms-panel-h"><h2>Get help with this {kind}</h2></div>
        <form className="tms-panel-b" onSubmit={e => { e.preventDefault(); openCase(topic, message.trim()); }}>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="tms-sub" style={{ marginBottom: 8 }}>What do you need?</legend>
            <div className="tms-options">
              {topics.map(t => (
                <label key={t.id} className={`tms-option${topic === t.id ? ' selected' : ''}`}>
                  <input type="radio" name="topic" value={t.id} checked={topic === t.id} onChange={() => setTopic(t.id)} />
                  {t.label}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="tms-field">
            <label htmlFor="help-msg">Details (optional)</label>
            <textarea id="help-msg" rows={3} value={message} onChange={e => setMessage(e.target.value)} />
          </div>
          <button className="tms-btn" disabled={sending}>{sending ? 'Sending' : 'Send request'}</button>
          {error && <div className="tms-error" style={{ marginTop: 10 }} role="alert">{error}</div>}
        </form>
      </section>

      {past.length > 0 && (
        <section className="tms-panel">
          <div className="tms-panel-h"><h2>Past requests</h2></div>
          <div className="tms-panel-b">
            {past.map(c => (
              <details key={c.id} style={{ marginBottom: 8 }}>
                <summary style={{ cursor: 'pointer' }}>{c.category_label} <span className="tms-sub">({c.id}, resolved)</span></summary>
                <div style={{ marginTop: 8 }}><CaseThread caseData={c} perspective="customer" /></div>
              </details>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
