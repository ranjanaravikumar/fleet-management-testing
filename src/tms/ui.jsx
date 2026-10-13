import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { fmtDate, fmtDateTime, fmtTime, fmtWindow, timeAgo } from '../api/tms';
import { useFreshIds, useNow } from '../hooks/useLiveData';
import { CASE_STATUS, SHIPMENT_STATUS, api, getSession, initials, setSession } from './lib';

// ── Shell ────────────────────────────────────────────────────────────

export function TopBar({ area }) {
  const session = getSession();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [error, setError] = useState('');

  async function search(e) {
    e.preventDefault();
    if (!q.trim()) return;
    try {
      const hit = await api.get(`/api/lookup?ref=${encodeURIComponent(q.trim())}`);
      const base = area === 'ops' ? '/tms/ops' : '/tms/portal';
      navigate(`${base}/${hit.type === 'shipment' ? 'shipments' : 'orders'}/${hit.id}`);
      setQ(''); setError('');
    } catch {
      setError(`Nothing matches ${q.trim()}`);
      setTimeout(() => setError(''), 3000);
    }
  }

  function signOut() {
    setSession(null);
    navigate('/tms');
  }

  return (
    <header className="tms-top">
      <div className="tms-brand">
        <span className="tms-brand-mark" aria-hidden="true">TP</span>
        TruckerPath <small>{area === 'ops' ? 'Operations' : 'Customer Portal'}</small>
      </div>
      <form className="tms-search" onSubmit={search} role="search">
        <input value={q} onChange={e => setQ(e.target.value)} aria-label="Find a shipment or order"
               placeholder="Find shipment, BOL or order number" />
        {error && <div className="tms-search-error" role="alert">{error}</div>}
      </form>
      <div className="tms-top-spacer" />
      {session && (
        <div className="tms-user">
          <span className="tms-avatar">{initials(session.name)}</span>
          <span><strong>{session.name}</strong>{session.company ? `, ${session.company}` : ''}</span>
          <button className="tms-signout" onClick={signOut}>Sign out</button>
        </div>
      )}
    </header>
  );
}

export function SideNav({ items }) {
  return (
    <nav className="tms-side" aria-label="Main">
      {items.map(item => item.group
        ? <div key={item.group} className="tms-side-group">{item.group}</div>
        : (
          <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? 'active' : '')}>
            {item.label}
            {item.count > 0 && <span className="tms-count">{item.count}</span>}
          </NavLink>
        ))}
    </nav>
  );
}

export function Tabs({ items }) {
  return (
    <nav className="tms-tabs" aria-label="Sections">
      {items.map(t => (
        <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => (isActive ? 'active' : '')}>{t.label}</NavLink>
      ))}
    </nav>
  );
}

export function PageHeader({ crumb, title, subtitle, children }) {
  return (
    <div className="tms-ph">
      <div>
        {crumb && <div className="tms-crumb">{crumb}</div>}
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children && <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>{children}</div>}
    </div>
  );
}

export function LiveNote({ live }) {
  const now = useNow(5000);
  if (live.error && !live.data) return <span className="tms-live off">Can't reach the TMS. Retrying</span>;
  if (!live.updatedAt) return <span className="tms-live off">Connecting</span>;
  return <span className="tms-live">Live, updated {timeAgo(new Date(live.updatedAt).toISOString(), now)}</span>;
}

export function ApiDown({ live }) {
  if (!live.error || live.data) return null;
  return (
    <div className="tms-error" role="alert">
      The TMS service isn't responding. Check that the backend is running
      (<code>uvicorn backend.main:app --reload --port 8000</code>). This page reconnects on its own.
    </div>
  );
}

// ── Status ───────────────────────────────────────────────────────────

export function ShipmentStatus({ status }) {
  return <span className={`tms-status ${SHIPMENT_STATUS[status] || 'tms-s-muted'}`}>{status}</span>;
}

export function CaseStatus({ status }) {
  const s = CASE_STATUS[status] || { label: status, tone: 'tms-s-muted' };
  return <span className={`tms-status ${s.tone}`}>{s.label}</span>;
}

// ── Tracking timeline ────────────────────────────────────────────────

export function Timeline({ shipment, alert }) {
  const done = shipment.milestones.map(m => ({
    key: `m${m.id}`, label: m.label, meta: fmtDateTime(m.event_time),
    src: m.source === 'carrier' ? 'Confirmed by carrier' : m.source === 'agent' ? 'Updated by TruckerPath' : null,
    state: 'done',
  }));
  const reached = new Set(shipment.milestones.map(m => m.code));
  const late = Boolean(alert);
  const pending = [];
  if (shipment.status !== 'Delivered') {
    if (!reached.has('ARRCONSIGNEE')) {
      pending.push({ key: 'p1', label: `Arrival in ${shipment.destination}`,
                     meta: `Appointment ${fmtWindow(shipment.delivery_appt_start, shipment.delivery_appt_end)}`,
                     state: late ? 'late' : '' });
    }
    pending.push({ key: 'p2', label: 'Delivery', meta: late ? 'Not confirmed yet' : 'Pending', state: late ? 'late' : '' });
  }
  return (
    <ol className="tms-tl">
      {[...done, ...pending].map(i => (
        <li key={i.key} className={i.state}>
          <span className="tms-tl-dot" aria-hidden="true" />
          <div>
            <div className="tms-tl-label">{i.label}</div>
            <div className="tms-tl-meta">{i.meta}{i.src && <span className="src">{i.src}</span>}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

// ── Case conversation ────────────────────────────────────────────────

function msgTime(iso) {
  const today = fmtDate(new Date().toISOString());
  return fmtDate(iso) === today ? fmtTime(iso) : fmtDate(iso);
}

/**
 * perspective: 'customer' (portal) or 'ops' (console).
 * onChange: called after a successful send, so the page can refresh.
 */
export function CaseThread({ caseData, perspective, onChange }) {
  const fresh = useFreshIds(caseData.messages);
  const [text, setText] = useState('');
  const [status, setStatus] = useState('');
  const [answers, setAnswers] = useState({});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const resolved = caseData.status === 'resolved';

  // The agent's latest request for details, if the customer hasn't answered it yet.
  const lastFormIdx = caseData.messages.map(m => Boolean(m.form)).lastIndexOf(true);
  const answered = lastFormIdx >= 0 && caseData.messages.slice(lastFormIdx + 1).some(m => m.form_response);
  const openForm = perspective === 'customer' && !resolved && lastFormIdx >= 0 && !answered
    ? caseData.messages[lastFormIdx].form : null;

  async function submit(payload) {
    setSending(true); setError('');
    try {
      if (perspective === 'customer') {
        await api.post(`/api/portal/cases/${caseData.id}/messages`, payload);
      } else {
        await api.post(`/api/cases/${caseData.id}/messages`,
          { author_type: 'ops', body: payload.body, status: status || undefined }, { auth: true });
      }
      setText(''); setAnswers({}); setStatus('');
      onChange?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      <div className="tms-thread">
        {caseData.messages.map(m => (
          <div key={m.id} className={`tms-msg ${m.author_type}${fresh.has(m.id) ? ' fresh' : ''}`}>
            <time className="tms-msg-time" dateTime={m.created_at} title={fmtDateTime(m.created_at)}>{msgTime(m.created_at)}</time>
            <div>
              {m.author_type !== 'system' && (
                <div className="tms-msg-who">
                  {m.author_name}
                  {m.author_type === 'agent' && <span className="tms-msg-tag">{perspective === 'ops' ? 'SMART API Agent' : 'Automated'}</span>}
                  {m.author_type === 'ops' && <span className="tms-msg-tag ops">Operations</span>}
                </div>
              )}
              <p className="tms-msg-body">{m.body}</p>
              {m.form && perspective === 'ops' && (
                <p className="tms-sub" style={{ marginTop: 4 }}>Asked the customer for: {m.form.fields.map(f => f.label).join(', ')}</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {openForm && (
        <form className="tms-form-ask" onSubmit={e => { e.preventDefault(); submit({ form_response: answers }); }}>
          {openForm.fields.map(f => (
            <div className="tms-field" key={f.name}>
              <label htmlFor={`f-${f.name}`}>{f.label}</label>
              <input id={`f-${f.name}`} required value={answers[f.name] || ''}
                     onChange={e => setAnswers(a => ({ ...a, [f.name]: e.target.value }))} />
            </div>
          ))}
          <button className="tms-btn" disabled={sending}>{sending ? 'Sending' : 'Send details'}</button>
        </form>
      )}

      {!resolved && !openForm && (
        <form className="tms-reply" onSubmit={e => { e.preventDefault(); if (text.trim()) submit({ body: text.trim() }); }}>
          <div className="tms-field">
            <label htmlFor={`r-${caseData.id}`}>{perspective === 'customer' ? 'Add a message' : 'Reply to the customer'}</label>
            <textarea id={`r-${caseData.id}`} value={text} onChange={e => setText(e.target.value)} rows={2} />
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {perspective === 'ops' && (
              <select aria-label="Set case status" value={status} onChange={e => setStatus(e.target.value)}
                      style={{ height: 32, border: '1px solid var(--line)', borderRadius: 5, font: 'inherit', padding: '0 8px' }}>
                <option value="">Keep status</option>
                <option value="awaiting_customer">Waiting on customer</option>
                <option value="needs_human">Needs a person</option>
                <option value="resolved">Resolve case</option>
              </select>
            )}
            <button className="tms-btn" disabled={sending || !text.trim()}>{sending ? 'Sending' : 'Send'}</button>
          </div>
        </form>
      )}
      {resolved && <p className="tms-sub" style={{ marginTop: 10 }}>Resolved {fmtDateTime(caseData.resolved_at)}.</p>}
      {error && <div className="tms-error" style={{ marginTop: 10 }} role="alert">{error}</div>}
    </div>
  );
}
