import { useState } from 'react';
import TpLogo from '../components/TpLogo';
import { useFleetState } from '../hooks/useFleetState';
import { useFreshIds, useLiveData, useNow } from '../hooks/useLiveData';
import { PORTAL_CUSTOMER, fmtDate, fmtDateTime, fmtWindow, timeAgo } from '../api/tms';
import { USER_SHIPMENTS } from '../data/mockData';

const STATUS_COLOR  = { 'In Transit': 'var(--blue-brand)', 'Delivered': 'var(--green)', 'Pending': 'var(--amber)', 'Invoiced ✓': 'var(--green)', 'Booked': 'var(--amber)', 'At Pickup': 'var(--amber)', 'At Delivery': 'var(--blue-brand)' };
const STATUS_BG     = { 'In Transit': 'rgba(28,142,232,0.1)', 'Delivered': 'rgba(16,185,129,0.1)', 'Pending': 'rgba(245,158,11,0.1)', 'Invoiced ✓': 'rgba(16,185,129,0.1)', 'Booked': 'rgba(245,158,11,0.1)', 'At Pickup': 'rgba(245,158,11,0.1)', 'At Delivery': 'rgba(28,142,232,0.1)' };
const STATUS_BORDER = { 'In Transit': 'rgba(28,142,232,0.25)', 'Delivered': 'rgba(16,185,129,0.25)', 'Pending': 'rgba(245,158,11,0.25)', 'Invoiced ✓': 'rgba(16,185,129,0.25)', 'Booked': 'rgba(245,158,11,0.25)', 'At Pickup': 'rgba(245,158,11,0.25)', 'At Delivery': 'rgba(28,142,232,0.25)' };

// What the customer sees while the agent is working on their shipment.
const AGENT_NOTE = {
  awaiting_carrier:  'We are checking with the carrier',
  awaiting_customer: 'Waiting for your reply',
  needs_human:       'Our operations team is on it',
};

const SOURCE_NOTE = { carrier: 'Confirmed by the carrier', agent: 'Updated by our team', customer: 'From you' };

// Turns a shipment from the TMS API into the shape the cards below use.
function toCard(s) {
  const done = s.milestones.map(m => ({
    label: m.label, time: fmtDateTime(m.event_time), done: true,
    note: SOURCE_NOTE[m.source],
  }));
  const reached = new Set(s.milestones.map(m => m.code));
  const pending = [];
  if (s.status !== 'Delivered') {
    if (!reached.has('ARRCONSIGNEE')) {
      pending.push({ label: `Arrival in ${s.destination}`, time: `Appointment ${fmtWindow(s.delivery_appt_start, s.delivery_appt_end)}`, done: false });
    }
    pending.push({ label: 'Delivery', time: 'Pending', done: false });
  }
  return {
    id: s.id,
    origin: s.origin,
    dest: s.destination,
    status: s.status,
    driver: s.driver_name || 'Driver not assigned',
    commodity: s.commodity,
    weight: s.weight_lbs ? `${s.weight_lbs.toLocaleString()} lbs` : '',
    eta: fmtDate(s.delivery_appt_start),
    amount: s.amount || '',
    trailer: s.trailer,
    bol: s.bol,
    truck: s.truck_id || 'Not assigned yet',
    carrier: s.carrier_name,
    pickupWindow: fmtWindow(s.pickup_appt_start, s.pickup_appt_end),
    deliveryWindow: fmtWindow(s.delivery_appt_start, s.delivery_appt_end),
    agentStatus: s.agent_status,
    updatedAt: s.updated_at,
    events: [...done, ...pending],
    live: true,
  };
}

function BookPane() {
  const { bookShipment } = useFleetState();
  const [form, setForm] = useState({ pickup: '', dest: '', pickupCity: '', destCity: '', pickupState: '', destState: '', pickupZip: '', destZip: '', pickupDate: '', pickupTime1: '08:00', pickupTime2: '17:00', commodity: '', weight: '', trailer: 'Dry Van', notes: '', name: '', company: '', email: '', phone: '' });
  const [submitted, setSubmitted] = useState(false);
  const [shipId, setShipId] = useState(() => `SHP-${Math.floor(1000 + Math.random() * 9000)}`);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const COMMODITIES = [{ e: '📦', l: 'General' }, { e: '❄️', l: 'Reefer' }, { e: '🏭', l: 'Industrial' }, { e: '💊', l: 'Pharma' }, { e: '🚗', l: 'Auto' }, { e: '🌽', l: 'Ag' }, { e: '⚗️', l: 'Hazmat' }, { e: '🛍️', l: 'Retail' }];

  if (submitted) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px', animation: 'cIn 0.5s var(--ease) both' }}>
        <div style={{ width: 80, height: 80, background: 'rgba(28,142,232,0.1)', border: '2px solid var(--blue-brand)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36, margin: '0 auto 24px' }}>✓</div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 800, letterSpacing: -1.5, marginBottom: 10 }}>
          Shipment <span style={{ color: 'var(--blue-brand)' }}>Booked!</span>
        </div>
        <div style={{ fontSize: 15, color: 'var(--text-muted)', marginBottom: 30 }}>
          Your booking has been received. A dispatcher will confirm and assign a driver within 2 hours. Confirmation sent to <strong>{form.email || 'your email'}</strong>.
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 15, color: 'var(--blue-brand)', background: 'rgba(28,142,232,0.08)', border: '1px solid rgba(28,142,232,0.25)', padding: '10px 28px', borderRadius: 100, display: 'inline-block', marginBottom: 24 }}>
          Reference: <strong>{shipId}</strong>
        </div>
        <div>
          <button className="sf-submit-btn" style={{ marginTop: 16 }} onClick={() => setSubmitted(false)}>
            Book Another Shipment
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="sf-header">
        <div className="sf-title">Book a Shipment</div>
        <div className="sf-sub">Fill in the details below to get an instant quote and book your freight.</div>
      </div>
      <form onSubmit={e => { e.preventDefault(); const id = bookShipment(form); setShipId(id); setSubmitted(true); }}>
        <div className="sf-grid" id="sfGrid">
          <div className="sf-section">
            <div className="sf-sec-title"><div className="sf-sec-icon">📍</div>Pickup Details</div>
            <div className="sf-group">
              <label className="sf-label sf-required">Pickup Address</label>
              <input className="sf-input" value={form.pickup} onChange={e => set('pickup', e.target.value)} placeholder="123 Industrial Blvd, Phoenix, AZ 85001" required />
            </div>
            <div className="sf-row">
              <div className="sf-group">
                <label className="sf-label sf-required">City</label>
                <input className="sf-input" value={form.pickupCity} onChange={e => set('pickupCity', e.target.value)} placeholder="Phoenix" required />
              </div>
              <div className="sf-group">
                <label className="sf-label sf-required">State</label>
                <select className="sf-select" value={form.pickupState} onChange={e => set('pickupState', e.target.value)} required>
                  <option value="">Select…</option>
                  {['AZ','CA','TX','CO','NV','UT','NM','OR','WA','IL','NY','FL','GA','OH'].map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div className="sf-row">
              <div className="sf-group">
                <label className="sf-label sf-required">ZIP Code</label>
                <input className="sf-input" value={form.pickupZip} onChange={e => set('pickupZip', e.target.value)} placeholder="85001" maxLength={5} />
              </div>
              <div className="sf-group">
                <label className="sf-label sf-required">Pickup Date</label>
                <input className="sf-input" type="date" value={form.pickupDate} onChange={e => set('pickupDate', e.target.value)} required />
              </div>
            </div>
            <div className="sf-group">
              <label className="sf-label">Pickup Window</label>
              <div className="sf-row">
                <input className="sf-input" type="time" value={form.pickupTime1} onChange={e => set('pickupTime1', e.target.value)} />
                <input className="sf-input" type="time" value={form.pickupTime2} onChange={e => set('pickupTime2', e.target.value)} />
              </div>
            </div>
          </div>
          <div className="sf-section">
            <div className="sf-sec-title"><div className="sf-sec-icon">🏁</div>Delivery Details</div>
            <div className="sf-group">
              <label className="sf-label sf-required">Delivery Address</label>
              <input className="sf-input" value={form.dest} onChange={e => set('dest', e.target.value)} placeholder="456 Commerce Ave, Dallas, TX 75201" required />
            </div>
            <div className="sf-row">
              <div className="sf-group">
                <label className="sf-label sf-required">City</label>
                <input className="sf-input" value={form.destCity} onChange={e => set('destCity', e.target.value)} placeholder="Dallas" required />
              </div>
              <div className="sf-group">
                <label className="sf-label sf-required">State</label>
                <select className="sf-select" value={form.destState} onChange={e => set('destState', e.target.value)} required>
                  <option value="">Select…</option>
                  {['AZ','CA','TX','CO','NV','UT','NM','OR','WA','IL','NY','FL','GA','OH'].map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div className="sf-row">
              <div className="sf-group">
                <label className="sf-label sf-required">ZIP Code</label>
                <input className="sf-input" value={form.destZip} onChange={e => set('destZip', e.target.value)} placeholder="75201" maxLength={5} />
              </div>
              <div className="sf-group">
                <label className="sf-label">Delivery Note</label>
                <input className="sf-input" value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Dock hours, special instructions…" />
              </div>
            </div>
          </div>
          <div className="sf-section">
            <div className="sf-sec-title"><div className="sf-sec-icon">📦</div>Freight Details</div>
            <div className="sf-row">
              <div className="sf-group">
                <label className="sf-label sf-required">Weight (lbs)</label>
                <input className="sf-input" type="number" value={form.weight} onChange={e => set('weight', e.target.value)} placeholder="e.g. 18000" required />
              </div>
              <div className="sf-group">
                <label className="sf-label sf-required">Trailer Type</label>
                <select className="sf-select" value={form.trailer} onChange={e => set('trailer', e.target.value)}>
                  {['Dry Van','Reefer','Flatbed','Step Deck','RGN','Tanker','Intermodal'].map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
            </div>
            <div className="sf-group">
              <label className="sf-label">Commodity Type</label>
              <div className="sf-commodity-grid">
                {COMMODITIES.map(c => (
                  <button key={c.l} type="button" className={`sf-comm-btn${form.commodity === c.l ? ' selected' : ''}`} onClick={() => set('commodity', c.l)}>
                    <span className="comm-icon">{c.e}</span>{c.l}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="sf-section">
            <div className="sf-sec-title"><div className="sf-sec-icon">👤</div>Contact Information</div>
            <div className="sf-row">
              <div className="sf-group">
                <label className="sf-label sf-required">Full Name</label>
                <input className="sf-input" value={form.name} onChange={e => set('name', e.target.value)} placeholder="Your name" required />
              </div>
              <div className="sf-group">
                <label className="sf-label sf-required">Company</label>
                <input className="sf-input" value={form.company} onChange={e => set('company', e.target.value)} placeholder="Your company" required />
              </div>
            </div>
            <div className="sf-row">
              <div className="sf-group">
                <label className="sf-label sf-required">Email</label>
                <input className="sf-input" type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="you@company.com" required />
              </div>
              <div className="sf-group">
                <label className="sf-label">Phone</label>
                <input className="sf-input" type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="(555) 000-0000" />
              </div>
            </div>
          </div>
          <div className="sf-submit-area">
            <div className="sf-terms">
              By submitting, you agree to our <a href="#">Terms of Service</a> and <a href="#">Privacy Policy</a>. We'll contact you within 2 hours to confirm pricing and scheduling.
            </div>
            <button type="submit" className="sf-submit-btn">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
              Request Booking
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function ShipPane({ shipments, live }) {
  const [selectedId, setSelectedId] = useState(null);
  const toggle = id => setSelectedId(prev => prev === id ? null : id);
  const now = useNow(1000);
  // Cards the agent changes while you watch glow once.
  const fresh = useFreshIds(live.connected ? shipments : null, s => `${s.id}|${s.updatedAt || ''}`);

  return (
    <div>
      <div className="sf-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div className="sf-title">My Shipments</div>
          <div className="sf-sub">{shipments.length} shipments · click any row to view details</div>
        </div>
        {live.connected
          ? <span className="live-pill on">Live tracking, updated {timeAgo(new Date(live.updatedAt).toISOString(), now)}</span>
          : <span className="live-pill off">Showing sample data. Live tracking is unavailable.</span>}
      </div>
      {shipments.map(s => {
        const isOpen = selectedId === s.id;
        return (
          <div key={s.id} className={`mship-card${isOpen ? ' open' : ''}${fresh.has(s.id) ? ' mship-fresh' : ''}`}>
            {/* Row */}
            <div className="mship-item" onClick={() => toggle(s.id)}>
              <div className="mship-icon" style={{ background: STATUS_BG[s.status], border: `1px solid ${STATUS_BORDER[s.status]}` }}>
                {s.status === 'Delivered' ? '✓' : s.status === 'In Transit' ? '🚚' : '⏳'}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="mship-id">{s.id}</div>
                <div className="mship-route">{s.origin} → {s.dest}</div>
                <div className="mship-meta">{s.driver} · {s.commodity} · {s.weight} · ETA {s.eta}</div>
                {s.agentStatus && AGENT_NOTE[s.agentStatus] && (
                  <div className="mship-agent">{AGENT_NOTE[s.agentStatus]}</div>
                )}
              </div>
              <div className="mship-right">
                <div className="mship-amount">{s.amount}</div>
                <div className="mship-eta" style={{ color: STATUS_COLOR[s.status], fontWeight: 700 }}>{s.status}</div>
              </div>
              <div className="mship-chevron" style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 9l6 6 6-6"/></svg>
              </div>
            </div>

            {/* Expanded Detail */}
            {isOpen && (
              <div className="mship-detail">
                {/* Info grid */}
                <div className="mship-detail-grid">
                  {(s.live ? [
                    { label: 'BOL Number',      value: s.bol },
                    { label: 'Truck',           value: s.truck },
                    { label: 'Trailer Type',    value: s.trailer },
                    { label: 'Driver',          value: s.driver },
                    { label: 'Pickup Window',   value: s.pickupWindow },
                    { label: 'Delivery Window', value: s.deliveryWindow },
                    { label: 'Carrier',         value: s.carrier },
                    { label: 'Freight Value',   value: s.amount },
                  ] : [
                    { label: 'BOL Number',    value: s.bol },
                    { label: 'Truck',         value: s.truck },
                    { label: 'Trailer Type',  value: s.trailer },
                    { label: 'Driver',        value: `${s.driver} · ${s.driverPhone}` },
                    { label: 'Pickup Date',   value: s.pickupDate },
                    { label: 'Delivery Date', value: s.deliveryDate },
                    { label: 'Distance',      value: s.distance },
                    { label: 'Freight Value', value: s.amount },
                  ]).map(({ label, value }) => (
                    <div key={label} className="mship-detail-cell">
                      <div className="mship-detail-label">{label}</div>
                      <div className="mship-detail-value">{value}</div>
                    </div>
                  ))}
                </div>

                {/* Tracking timeline */}
                <div className="mship-timeline-title">Tracking History</div>
                <div className="mship-timeline">
                  {s.events.map((ev, i) => (
                    <div key={i} className="mship-tl-row">
                      <div className="mship-tl-left">
                        <div className={`mship-tl-dot${ev.done ? ' done' : ' pending'}`} />
                        {i < s.events.length - 1 && <div className={`mship-tl-line${ev.done ? ' done' : ''}`} />}
                      </div>
                      <div className="mship-tl-body">
                        <div className={`mship-tl-label${ev.done ? '' : ' pending'}`}>{ev.label}</div>
                        <div className="mship-tl-time">{ev.time}{ev.note && <span className="mship-tl-source">{ev.note}</span>}</div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Actions */}
                <div className="mship-detail-actions">
                  <button className="mship-action-btn">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
                    Download BOL
                  </button>
                  <button className="mship-action-btn">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    View Invoice
                  </button>
                  <button className="mship-action-btn">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>
                    Call Driver
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function QuotePane() {
  const [form, setForm] = useState({ origin: '', dest: '', weight: '', trailer: 'Dry Van' });
  const [quote, setQuote] = useState(null);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const calc = e => {
    e.preventDefault();
    const base = 900 + Math.random() * 1100;
    setQuote({ low: Math.round(base * 0.88), high: Math.round(base * 1.12), transit: `${2 + Math.floor(Math.random() * 3)}–${3 + Math.floor(Math.random() * 3)} days` });
  };

  return (
    <div style={{ maxWidth: 600 }}>
      <div className="sf-header">
        <div className="sf-title">Quick Rate Quote</div>
        <div className="sf-sub">Get an instant rate estimate for any lane.</div>
      </div>
      <form className="sf-section" onSubmit={calc}>
        <div className="sf-sec-title"><div className="sf-sec-icon">💰</div>Rate Calculator</div>
        <div className="sf-row">
          <div className="sf-group">
            <label className="sf-label sf-required">Origin (City or ZIP)</label>
            <input className="sf-input" value={form.origin} onChange={e => set('origin', e.target.value)} placeholder="Chicago, IL or 60601" required />
          </div>
          <div className="sf-group">
            <label className="sf-label sf-required">Destination</label>
            <input className="sf-input" value={form.dest} onChange={e => set('dest', e.target.value)} placeholder="Dallas, TX or 75201" required />
          </div>
        </div>
        <div className="sf-row">
          <div className="sf-group">
            <label className="sf-label sf-required">Weight (lbs)</label>
            <input className="sf-input" type="number" value={form.weight} onChange={e => set('weight', e.target.value)} placeholder="e.g. 20000" required />
          </div>
          <div className="sf-group">
            <label className="sf-label">Trailer Type</label>
            <select className="sf-select" value={form.trailer} onChange={e => set('trailer', e.target.value)}>
              {['Dry Van','Reefer','Flatbed','Step Deck','Tanker'].map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
        </div>
        <button type="submit" className="sf-submit-btn" style={{ marginTop: 8 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
          Calculate Rate
        </button>
      </form>
      {quote && (
        <div className="sf-estimate" style={{ marginTop: 16 }}>
          <div>
            <div className="sf-estimate-label">Estimated Rate Range</div>
            <div className="sf-estimate-note">Based on current market rates</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="sf-estimate-price">${quote.low.toLocaleString()} – ${quote.high.toLocaleString()}</div>
            <div className="sf-estimate-note">Transit: {quote.transit}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function ProfilePane({ onLogout }) {
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState({ name: 'John Smith', company: 'Smith Industries', email: 'user@company.com', phone: '(555) 000-0000', address: '' });
  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); setSaved(false); };

  return (
    <div>
      <div className="sf-header">
        <div className="sf-title">My Profile</div>
        <div className="sf-sub">Manage your account information.</div>
      </div>
      <div className="profile-grid">
        <div className="profile-card">
          <div className="profile-avatar-big">JS</div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{form.name}</div>
            <div style={{ fontSize: 13, color: 'var(--text-faint)' }}>{form.company}</div>
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 8, padding: '10px 14px', textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: 1 }}>Total Shipped</div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800, color: 'var(--green)' }}>$24,180</div>
              </div>
              <div style={{ background: 'rgba(28,142,232,0.08)', border: '1px solid rgba(28,142,232,0.2)', borderRadius: 8, padding: '10px 14px', textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: 1 }}>Active Loads</div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800, color: 'var(--blue-brand)' }}>2</div>
              </div>
            </div>
          </div>
        </div>
        <div className="sf-section">
          <div className="sf-sec-title"><div className="sf-sec-icon">👤</div>Account Information</div>
          <div className="sf-row">
            <div className="sf-group">
              <label className="sf-label">Full Name</label>
              <input className="sf-input" value={form.name} onChange={e => set('name', e.target.value)} />
            </div>
            <div className="sf-group">
              <label className="sf-label">Company</label>
              <input className="sf-input" value={form.company} onChange={e => set('company', e.target.value)} />
            </div>
          </div>
          <div className="sf-row">
            <div className="sf-group">
              <label className="sf-label">Email</label>
              <input className="sf-input" type="email" value={form.email} onChange={e => set('email', e.target.value)} />
            </div>
            <div className="sf-group">
              <label className="sf-label">Phone</label>
              <input className="sf-input" type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} />
            </div>
          </div>
          <div className="sf-group">
            <label className="sf-label">Billing Address</label>
            <input className="sf-input" value={form.address} onChange={e => set('address', e.target.value)} placeholder="Street, City, State, ZIP" />
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <button className="sf-submit-btn" type="button" onClick={() => setSaved(true)} style={{ flex: 1 }}>
              {saved ? '✓ Saved!' : 'Save Changes'}
            </button>
            <button type="button" onClick={onLogout} style={{ background: 'transparent', border: '1px solid rgba(239,68,68,0.35)', color: '#F87171', padding: '12px 20px', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: 7 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3"/></svg>
              Sign Out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const TABS = [
  { id: 'book', label: 'Book Shipment', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg> },
  { id: 'track', label: 'My Shipments', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg> },
  { id: 'quotes', label: 'Quick Quote', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg> },
  { id: 'profile', label: 'My Profile', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> },
];

const MOCK_IDS = new Set(USER_SHIPMENTS.map(s => s.id));

export default function UserDashboard({ onLogout }) {
  const [tab, setTab] = useState('book');
  const { userShipments } = useFleetState();

  // Live shipments and account details from the TMS API, refreshed every few seconds.
  const live = useLiveData(`/api/shipments?customer_code=${PORTAL_CUSTOMER}`, 3000);
  const account = useLiveData(`/api/customers/${PORTAL_CUSTOMER}`, 60000);
  const connected = Boolean(live.data) && !live.error;

  // Live data when the API answers; the old sample data when it doesn't.
  // Shipments booked in this browser session are kept either way.
  const bookedHere = userShipments.filter(s => !MOCK_IDS.has(s.id));
  const shipments = connected
    ? [...bookedHere, ...live.data.map(toCard)]
    : userShipments;

  const active = shipments.filter(s => s.status !== 'Delivered').length;
  const total = shipments.reduce((sum, s) => sum + (Number(String(s.amount).replace(/[^0-9.]/g, '')) || 0), 0);
  const contact = (connected && account.data?.contact) || 'John Smith';
  const company = (connected && account.data?.name) || 'Smith Industries';
  const initials = contact.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#05080F', display: 'flex', flexDirection: 'column', zIndex: 7000 }}>
      {/* Nav */}
      <div className="udash-nav">
        <div className="unav-logo">
          <div style={{ width: 28, height: 28, borderRadius: 7, overflow: 'hidden', flexShrink: 0 }}>
            <TpLogo size={28} />
          </div>
          Trucker<span style={{ color: '#60A5FA' }}>Path</span>
          <span style={{ fontSize: 11, fontWeight: 500, color: 'rgba(241,245,249,0.3)', fontFamily: 'var(--font-body)' }}>Customer Portal</span>
        </div>
        <div className="unav-spacer" />
        <div style={{ display: 'flex', gap: 20, alignItems: 'center', marginRight: 20 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 10, color: 'rgba(241,245,249,0.3)', textTransform: 'uppercase', letterSpacing: 1 }}>Active Shipments</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#10B981' }}>{active}</div>
          </div>
          <div style={{ width: 1, height: 28, background: 'var(--border)' }} />
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 10, color: 'rgba(241,245,249,0.3)', textTransform: 'uppercase', letterSpacing: 1 }}>Total Shipped</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--amber)' }}>${total.toLocaleString('en-US')}</div>
          </div>
        </div>
        <div className="unav-user">
          <div className="unav-avatar">{initials}</div>
          <div className="unav-name">{contact}</div>
          <div style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 4px' }} />
          <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{company}</div>
        </div>
        <button className="unav-signout" onClick={onLogout}>Sign Out</button>
      </div>

      {/* Tabs */}
      <div className="udash-tabs">
        {TABS.map(t => (
          <div key={t.id} className={`udash-tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
            {t.icon}
            {t.label}
          </div>
        ))}
      </div>

      {/* Content */}
      <div className="udash-content">
        {tab === 'book'    && <BookPane />}
        {tab === 'track'   && <ShipPane shipments={shipments} live={{ connected, updatedAt: live.updatedAt }} />}
        {tab === 'quotes'  && <QuotePane />}
        {tab === 'profile' && <ProfilePane onLogout={onLogout} />}
      </div>
    </div>
  );
}
