import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { fmtDate, fmtDateTime, fmtTime, fmtWindow, timeAgo } from '../api/tms';
import { useFreshIds, useNow } from '../hooks/useLiveData';
import { NOTE_ACTION, SHIPMENT_STATUS, api, getSession, initials, setSession } from './lib';

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
        Qubiway <small>{area === 'ops' ? 'Operations' : 'Customer Portal'}</small>
      </div>
      <form className="tms-search" onSubmit={search} role="search">
        <input value={q} onChange={e => setQ(e.target.value)} aria-label="Find a shipment or order"
               placeholder="Find shipment, BOL, PO, PRO or order" />
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

export function TrackingAlert({ alert }) {
  return alert ? <div className="tms-inline-note warn">{alert}</div> : null;
}

/** Tabs inside a record page: [{ id, label }]. */
export function RecordTabs({ tabs, tab, onChange }) {
  return (
    <div className="tms-tabs" style={{ padding: '0 6px', borderRadius: '6px 6px 0 0' }} role="tablist">
      {tabs.map(t => (
        <a key={t.id} role="tab" aria-selected={tab === t.id} href={`#${t.id}`} className={tab === t.id ? 'active' : ''}
           onClick={e => { e.preventDefault(); onChange(t.id); }}>{t.label}</a>
      ))}
    </div>
  );
}

// ── Tracking timeline ────────────────────────────────────────────────

export function Timeline({ shipment }) {
  const done = shipment.milestones.map(m => ({
    key: `m${m.id}`, label: m.label, meta: fmtDateTime(m.event_time),
    src: m.source === 'carrier' ? 'Confirmed by carrier' : m.source === 'agent' || m.source === 'staff' ? 'Updated by Qubiway' : null,
    state: 'done',
  }));
  const reached = new Set(shipment.milestones.map(m => m.code));
  const late = shipment.tracking_alert === 'Delivery overdue';
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

// ── Notes ────────────────────────────────────────────────────────────

function noteTime(iso) {
  const today = fmtDate(new Date().toISOString());
  return fmtDate(iso) === today ? fmtTime(iso) : fmtDate(iso);
}

/**
 * The Notes tab on a shipment or order.
 * perspective: 'customer' (portal: only customer-visible notes, posts as the customer)
 *              or 'ops' (console: every note, can post internal or customer-visible).
 * onChange: called after a note is added, so the page can refresh.
 */
export function NotesPanel({ notes, entityType, entityId, customerCode, perspective, onChange }) {
  const fresh = useFreshIds(notes);
  const [text, setText] = useState('');
  const [visibility, setVisibility] = useState('internal');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const ordered = [...notes].sort((a, b) => a.id - b.id);

  async function submit(e) {
    e.preventDefault();
    if (!text.trim()) return;
    setSending(true); setError('');
    try {
      if (perspective === 'customer') {
        await api.post('/api/portal/notes',
          { customer_code: customerCode, entity_type: entityType, entity_id: entityId, message: text.trim() });
      } else {
        const session = getSession();
        await api.post('/api/notes', {
          entity_type: entityType, entity_id: entityId, message: text.trim(), visibility,
          author: session?.name || 'Qubiway Operations', author_type: 'staff',
        }, { auth: true });
      }
      setText('');
      onChange?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      {ordered.length === 0 && <p className="tms-sub">No notes yet.</p>}
      <div className="tms-thread">
        {ordered.map(n => (
          <div key={n.id} className={`tms-msg${n.author_type === 'system' ? ' system' : ''}${fresh.has(n.id) ? ' fresh' : ''}`}>
            <time className="tms-msg-time" dateTime={n.created_at} title={fmtDateTime(n.created_at)}>{noteTime(n.created_at)}</time>
            <div>
              <div className="tms-msg-who">
                {n.author}
                {n.action !== 'note' && <span className="tms-msg-tag plain">{NOTE_ACTION[n.action] || n.action}</span>}
                {perspective === 'ops' && n.visibility === 'customer' && <span className="tms-msg-tag ops">Visible to customer</span>}
              </div>
              <p className="tms-msg-body">{n.message}</p>
              {perspective === 'ops' && n.source_ref && <div className="tms-feed-ref">Ref: {n.source_ref}</div>}
            </div>
          </div>
        ))}
      </div>

      <form className="tms-reply" onSubmit={submit}>
        <div className="tms-field">
          <label htmlFor={`note-${entityId}`}>{perspective === 'customer' ? 'Add a note or question' : 'Add a note'}</label>
          <textarea id={`note-${entityId}`} value={text} onChange={e => setText(e.target.value)} rows={2} maxLength={2000} />
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {perspective === 'ops' && (
            <select aria-label="Who can see this note" value={visibility} onChange={e => setVisibility(e.target.value)}
                    style={{ height: 32, border: '1px solid var(--line)', borderRadius: 5, font: 'inherit', padding: '0 8px' }}>
              <option value="internal">Internal only</option>
              <option value="customer">Also visible to the customer</option>
            </select>
          )}
          <button className="tms-btn" disabled={sending || !text.trim()}>{sending ? 'Saving' : 'Add note'}</button>
        </div>
      </form>
      {error && <div className="tms-error" style={{ marginTop: 10 }} role="alert">{error}</div>}
    </div>
  );
}

// ── Tables: sorting and searching ────────────────────────────────────

export function SortTh({ id, sort, onSort, children, className }) {
  const active = sort.key === id;
  return (
    <th className={className} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className={`tms-sort${active ? ' on' : ''}`} onClick={() => onSort(id)}>
        {children}<span aria-hidden="true">{active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
      </button>
    </th>
  );
}

export function SearchBox({ value, onChange, label, placeholder }) {
  return (
    <input className="tms-searchbox" type="search" value={value} onChange={e => onChange(e.target.value)}
           aria-label={label} placeholder={placeholder} />
  );
}

export function FilterChips({ items, value, onChange, label }) {
  return (
    <div className="tms-filters" role="group" aria-label={label}>
      {items.map(f => (
        <button key={f.id} type="button" className={value === f.id ? 'on' : ''} aria-pressed={value === f.id}
                onClick={() => onChange(f.id)}>
          {f.label}{f.count !== undefined && <span className="tms-chip-n">{f.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function KV({ items }) {
  return (
    <dl className="tms-kv">
      {items.filter(Boolean).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v || v === 0 ? v : <span className="tms-sub">None</span>}</dd></div>)}
    </dl>
  );
}

export function ErrorNote({ error }) {
  return error ? <div className="tms-error" style={{ marginTop: 10, marginBottom: 0 }} role="alert">{error}</div> : null;
}
