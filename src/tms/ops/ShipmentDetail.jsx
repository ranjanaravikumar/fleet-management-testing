import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useLiveData } from '../../hooks/useLiveData';
import { fmtDateTime, fmtWindow } from '../../api/tms';
import { ErrorNote, KV, LiveNote, NotesPanel, PageHeader, RecordTabs, ShipmentStatus, Timeline } from '../ui';
import { INVOICE_STATUS, MILESTONE_CODES, api, fromPhxInput, getSession, money, toPhxInput, tmsUrl } from '../lib';

const author = () => getSession()?.name;

// ── Tracking: record a check call ────────────────────────────────────

function nowLocalInput() {
  return toPhxInput(new Date().toISOString());
}

/** Record a tracking milestone, as a dispatcher does after a check call. */
function AddMilestone({ shipment, onDone }) {
  const [code, setCode] = useState('INTRANSIT');
  const [when, setWhen] = useState(nowLocalInput);
  const [location, setLocation] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setSending(true); setError('');
    try {
      await api.post(`/api/shipments/${shipment.id}/milestones`, {
        code, event_time: fromPhxInput(when), location: location.trim() || undefined,
        source: 'staff', reason: 'Recorded by operations', author: author(),
      }, { auth: true });
      setLocation('');
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <form className="tms-reply" onSubmit={submit}>
      <div className="tms-form-grid">
        <div className="tms-field">
          <label htmlFor="ms-code">Tracking update</label>
          <select id="ms-code" value={code} onChange={e => setCode(e.target.value)}>
            {MILESTONE_CODES.map(m => <option key={m.code} value={m.code}>{m.label}</option>)}
          </select>
        </div>
        <div className="tms-field">
          <label htmlFor="ms-when">When (Phoenix time)</label>
          <input id="ms-when" type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} required />
        </div>
        <div className="tms-field">
          <label htmlFor="ms-loc">Location</label>
          <input id="ms-loc" value={location} onChange={e => setLocation(e.target.value)} placeholder="City, ST" />
        </div>
      </div>
      <button className="tms-btn secondary" disabled={sending}>{sending ? 'Saving' : 'Add tracking update'}</button>
      <ErrorNote error={error} />
    </form>
  );
}

// ── Stops ────────────────────────────────────────────────────────────

function firstTime(s, code) {
  return s.milestones.find(m => m.code === code)?.event_time;
}

function lateness(actual, apptEnd) {
  if (!actual || !apptEnd) return null;
  const mins = Math.round((new Date(actual) - new Date(apptEnd)) / 60000);
  return mins > 0 ? `${mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`} late` : 'On time';
}

function Stop({ n, kind, name, address, city, start, end, arrived, left, alert }) {
  const late = lateness(arrived, end);
  return (
    <section className={`tms-stop${alert ? ' warn' : ''}`} aria-label={`Stop ${n}: ${kind}`}>
      <div className="tms-stop-n" aria-hidden="true">{n}</div>
      <div>
        <div className="tms-stop-kind">{kind}</div>
        <h3>{name || city}</h3>
        <p className="tms-sub">{address || city}</p>
        <dl className="tms-kv" style={{ marginTop: 10 }}>
          <div><dt>Appointment</dt><dd>{fmtWindow(start, end)}</dd></div>
          <div><dt>Arrived</dt><dd>{arrived ? fmtDateTime(arrived) : <span className="tms-sub">Not yet</span>}
            {late && <div className={late === 'On time' ? 'tms-inline-note ok' : 'tms-inline-note warn'}>{late}</div>}</dd></div>
          <div><dt>{kind === 'Pickup' ? 'Loaded and departed' : 'Delivered'}</dt>
            <dd>{left ? fmtDateTime(left) : <span className="tms-sub">Not yet</span>}</dd></div>
        </dl>
        {alert && <div className="tms-callout warn" style={{ marginTop: 10 }}>{alert}</div>}
      </div>
    </section>
  );
}

function StopsTab({ s }) {
  return (
    <div className="tms-stops">
      <Stop n={1} kind="Pickup" name={s.shipper_name} address={s.shipper_address} city={s.origin}
            start={s.pickup_appt_start} end={s.pickup_appt_end}
            arrived={firstTime(s, 'ARRSHIP')} left={firstTime(s, 'PICK')}
            alert={s.tracking_alert === 'Pickup overdue' ? 'Pickup window has passed with no pickup recorded.' : null} />
      <Stop n={2} kind="Delivery" name={s.consignee_name} address={s.consignee_address} city={s.destination}
            start={s.delivery_appt_start} end={s.delivery_appt_end}
            arrived={firstTime(s, 'ARRCONSIGNEE')} left={firstTime(s, 'DELV')}
            alert={s.tracking_alert === 'Delivery overdue' ? 'Delivery window has passed with no delivery recorded.' : null} />
    </div>
  );
}

// ── Documents ────────────────────────────────────────────────────────

const DOC_TYPES = ['POD', 'BOL', 'Rate confirmation', 'Invoice', 'Lumper receipt', 'Other'];

function readBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error(`Couldn't read ${file.name}.`));
    r.readAsDataURL(file);
  });
}

function DocumentsTab({ s, onChange }) {
  const docs = useLiveData(`/api/shipments/${encodeURIComponent(s.id)}/documents`, 10000);
  const [type, setType] = useState('POD');
  const [file, setFile] = useState(null);
  const [inputKey, setInputKey] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const list = docs.data || [];
  const hasPod = list.some(d => d.doc_type === 'POD') || s.milestones.some(m => m.code === 'POD');

  async function upload(e) {
    e.preventDefault();
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setError('Files must be 5 MB or smaller.'); return; }
    setSending(true); setError('');
    try {
      await api.post(`/api/shipments/${s.id}/documents`, {
        doc_type: type, filename: file.name, content_type: file.type || 'application/octet-stream',
        content_base64: await readBase64(file), author: author(),
      }, { auth: true });
      setFile(null); setInputKey(k => k + 1);
      docs.reload(); onChange();
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      {s.status === 'Delivered' && !hasPod && (
        <div className="tms-callout warn" style={{ marginBottom: 12 }}>Delivered, but no proof of delivery is on file yet.</div>
      )}
      <table className="tms-table">
        <thead><tr><th>Document</th><th>Type</th><th>Added</th><th /></tr></thead>
        <tbody>
          <tr>
            <td>Bill of lading {s.bol}</td><td>BOL</td><td className="tms-sub">Generated from the shipment</td>
            <td className="tms-num"><a href={tmsUrl(`/api/shipments/${s.id}/print/bol`)} target="_blank" rel="noreferrer">Open</a></td>
          </tr>
          <tr>
            <td>Rate confirmation for {s.carrier_name}</td><td>Rate confirmation</td><td className="tms-sub">Generated from the shipment</td>
            <td className="tms-num"><a href={tmsUrl(`/api/shipments/${s.id}/print/rate-confirmation`)} target="_blank" rel="noreferrer">Open</a></td>
          </tr>
          {list.map(d => (
            <tr key={d.id}>
              <td>{d.filename}<div className="tms-sub">{(d.size / 1024).toFixed(1)} KB</div></td>
              <td>{d.doc_type}</td>
              <td>{fmtDateTime(d.created_at)}<div className="tms-sub">{d.uploaded_by}</div></td>
              <td className="tms-num"><a href={tmsUrl(`/api/documents/${d.id}/file`)} target="_blank" rel="noreferrer">Open</a></td>
            </tr>
          ))}
        </tbody>
      </table>
      <form className="tms-reply" onSubmit={upload}>
        <div className="tms-form-grid">
          <div className="tms-field">
            <label htmlFor="doc-type">Document type</label>
            <select id="doc-type" value={type} onChange={e => setType(e.target.value)}>
              {DOC_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div className="tms-field" style={{ gridColumn: 'span 2' }}>
            <label htmlFor="doc-file">File (PDF or image, up to 5 MB)</label>
            <input key={inputKey} id="doc-file" type="file" accept=".pdf,image/*,.txt"
                   onChange={e => setFile(e.target.files?.[0] || null)} />
          </div>
        </div>
        <button className="tms-btn secondary" disabled={sending || !file}>{sending ? 'Uploading' : 'Attach document'}</button>
        <ErrorNote error={error} />
      </form>
    </div>
  );
}

// ── Check calls ──────────────────────────────────────────────────────

function nowPhxInput() {
  // current time expressed in Phoenix local (UTC-7) for a datetime-local field
  const d = new Date(Date.now() - 7 * 3600 * 1000);
  return d.toISOString().slice(0, 16);
}

function CheckCallsTab({ s }) {
  const live = useLiveData(`/api/shipments/${encodeURIComponent(s.id)}/check-calls`, 10000);
  const [calledAt, setCalledAt] = useState(() => nowPhxInput());
  const [spokeTo, setSpokeTo] = useState('');
  const [location, setLocation] = useState('');
  const [milesOut, setMilesOut] = useState('');
  const [eta, setEta] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const list = live.data || [];

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await api.post(`/api/shipments/${s.id}/check-calls`, {
        called_at: `${calledAt}:00-07:00`,
        spoke_to: spokeTo.trim() || undefined,
        location: location.trim() || undefined,
        miles_out: milesOut ? Number(milesOut) : undefined,
        eta: eta ? `${eta}:00-07:00` : undefined,
        note: note.trim() || undefined,
        author: author(),
      }, { auth: true });
      setSpokeTo(''); setLocation(''); setMilesOut(''); setEta(''); setNote('');
      setCalledAt(nowPhxInput());
      live.reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <table className="tms-table">
        <thead>
          <tr><th>Time</th><th>Spoke with</th><th>Location</th><th>Miles out</th><th>ETA</th><th>Note</th></tr>
        </thead>
        <tbody>
          {list.map(cc => (
            <tr key={cc.id}>
              <td className="tms-sub" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(cc.called_at)}</td>
              <td>{cc.spoke_to || <span className="tms-sub">—</span>}</td>
              <td>{cc.location || <span className="tms-sub">—</span>}</td>
              <td className="tms-num">{cc.miles_out != null ? cc.miles_out.toLocaleString() : <span className="tms-sub">—</span>}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{cc.eta ? fmtDateTime(cc.eta) : <span className="tms-sub">—</span>}</td>
              <td>{cc.note || ''}</td>
            </tr>
          ))}
          {list.length === 0 && <tr><td colSpan={6} className="tms-sub">No check calls recorded yet.</td></tr>}
        </tbody>
      </table>
      {s.status !== 'Delivered' && (
        <form className="tms-reply" onSubmit={submit}>
          <div className="tms-form-grid tms-form-grid-4">
            <div className="tms-field">
              <label htmlFor="cc-when">Time (Phoenix)</label>
              <input id="cc-when" type="datetime-local" value={calledAt} onChange={e => setCalledAt(e.target.value)} required />
            </div>
            <div className="tms-field">
              <label htmlFor="cc-who">Spoke with</label>
              <input id="cc-who" value={spokeTo} onChange={e => setSpokeTo(e.target.value)} placeholder="Driver name" />
            </div>
            <div className="tms-field">
              <label htmlFor="cc-loc">Location</label>
              <input id="cc-loc" value={location} onChange={e => setLocation(e.target.value)} placeholder="City, ST or I-10 MM 120" />
            </div>
            <div className="tms-field">
              <label htmlFor="cc-mi">Miles out</label>
              <input id="cc-mi" type="number" min="0" value={milesOut} onChange={e => setMilesOut(e.target.value)} />
            </div>
            <div className="tms-field">
              <label htmlFor="cc-eta">ETA (Phoenix)</label>
              <input id="cc-eta" type="datetime-local" value={eta} onChange={e => setEta(e.target.value)} />
            </div>
            <div className="tms-field" style={{ gridColumn: 'span 3' }}>
              <label htmlFor="cc-note">Note</label>
              <input id="cc-note" value={note} onChange={e => setNote(e.target.value)} placeholder="Any issues or details" />
            </div>
          </div>
          <button className="tms-btn secondary" disabled={busy}>{busy ? 'Saving' : 'Record check call'}</button>
          <ErrorNote error={error} />
        </form>
      )}
    </div>
  );
}

// ── Charges and invoicing ────────────────────────────────────────────

const CHARGE_CODES = {
  customer: [
    { code: 'LH',    label: 'Linehaul',              default_rate: null },
    { code: 'FSC',   label: 'Fuel surcharge',         default_rate: null },
    { code: 'DET',   label: 'Detention',              default_rate: 75   },
    { code: 'LUM',   label: 'Lumper',                 default_rate: 150  },
    { code: 'TONU',  label: 'Truck ordered not used', default_rate: 250  },
    { code: 'REDEL', label: 'Redelivery',             default_rate: 150  },
    { code: 'STOP',  label: 'Extra stop',             default_rate: 100  },
    { code: 'LAY',   label: 'Layover',                default_rate: 350  },
    { code: 'OTH',   label: 'Accessorial',            default_rate: null },
  ],
  carrier: [
    { code: 'CPY',   label: 'Carrier pay',            default_rate: null },
    { code: 'FC',    label: 'Fleet cost',              default_rate: null },
    { code: 'DET',   label: 'Detention',              default_rate: 75   },
    { code: 'LUM',   label: 'Lumper',                 default_rate: 150  },
    { code: 'TONU',  label: 'Truck ordered not used', default_rate: 250  },
    { code: 'STOP',  label: 'Extra stop',             default_rate: 100  },
    { code: 'LAY',   label: 'Layover',                default_rate: 350  },
    { code: 'OTH',   label: 'Accessorial',            default_rate: null },
  ],
};

function ChargeTable({ title, items, total, locked, onDelete }) {
  return (
    <section style={{ marginBottom: 16 }}>
      <h3 className="tms-h3">{title}</h3>
      <table className="tms-table">
        <thead><tr><th>Charge</th><th>Description</th><th className="tms-num">Amount</th><th /></tr></thead>
        <tbody>
          {items.map(i => (
            <tr key={i.id}>
              <td>{i.type}</td><td>{i.description}</td><td className="tms-num">{money(i.amount)}</td>
              <td className="tms-num">{!locked && <button className="tms-link-btn" onClick={() => onDelete(i)}>Remove</button>}</td>
            </tr>
          ))}
          {items.length === 0 && <tr><td colSpan={4} className="tms-sub">No charges yet.</td></tr>}
          <tr className="tms-total"><td colSpan={2}>Total</td><td className="tms-num">{money(total)}</td><td /></tr>
        </tbody>
      </table>
    </section>
  );
}

function ChargesTab({ s, onChange }) {
  const live = useLiveData(`/api/shipments/${encodeURIComponent(s.id)}/charges`, 10000);
  const [side, setSide] = useState('customer');
  const [codeObj, setCodeObj] = useState(() => CHARGE_CODES.customer[2]);
  const [desc, setDesc] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const c = live.data;
  if (!c) return <p className="tms-sub">Loading charges</p>;
  const locked = c.invoice_status !== 'Not invoiced';

  function switchCode(newCode) {
    setCodeObj(newCode);
    if (newCode.default_rate != null) setAmount(String(newCode.default_rate));
  }

  function switchSide(newSide) {
    setSide(newSide);
    const first = CHARGE_CODES[newSide][0];
    setCodeObj(first);
    if (first.default_rate != null) setAmount(String(first.default_rate)); else setAmount('');
  }

  async function run(fn) {
    setBusy(true); setError('');
    try { await fn(); live.reload(); onChange(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  const add = e => {
    e.preventDefault();
    run(async () => {
      await api.post(`/api/shipments/${s.id}/charges`,
        { side, type: codeObj.label, description: desc.trim() || undefined, amount: Number(amount), author: author() },
        { auth: true });
      setDesc(''); setAmount('');
    });
  };
  const remove = i => run(() => api.del(`/api/charges/${i.id}?author=${encodeURIComponent(author() || '')}`, { auth: true }));
  const invoice = () => run(() => api.post(`/api/shipments/${s.id}/invoice`, { author: author() }, { auth: true }));
  const paid = () => run(() => api.post(`/api/shipments/${s.id}/invoice/paid`, { author: author() }, { auth: true }));

  return (
    <div>
      <dl className="tms-metrics tms-metrics-tight">
        <div className="tms-metric"><dt>Billed to customer</dt><dd>{money(c.customer_total)}</dd></div>
        <div className="tms-metric"><dt>Paid to carrier</dt><dd>{money(c.carrier_total)}</dd></div>
        <div className="tms-metric"><dt>Margin</dt><dd className={c.margin < 0 ? 'tms-bad' : ''}>{money(c.margin)}
          {c.margin_pct !== null && <small> {c.margin_pct}%</small>}</dd></div>
        <div className="tms-metric"><dt>Invoice</dt><dd className="tms-metric-text">
          <span className={`tms-status ${INVOICE_STATUS[c.invoice_status]}`}>{c.invoice_status}</span>
          {c.invoice_number && <div className="tms-sub">{c.invoice_number}, {fmtDateTime(c.invoiced_at)}</div>}</dd></div>
      </dl>
      <div className="tms-actions" style={{ marginBottom: 14 }}>
        {c.invoice_status === 'Not invoiced' && (
          <button className="tms-btn" disabled={busy || s.status !== 'Delivered'} onClick={invoice}
                  title={s.status !== 'Delivered' ? 'Invoice after delivery' : undefined}>Create invoice</button>
        )}
        {c.invoice_status === 'Invoiced' && <button className="tms-btn" disabled={busy} onClick={paid}>Record payment</button>}
        {s.status !== 'Delivered' && <span className="tms-sub">Invoicing opens once the shipment is delivered.</span>}
        {locked && <span className="tms-sub">Customer charges are locked after invoicing.</span>}
      </div>
      <ChargeTable title="Customer charges" items={c.items.filter(i => i.side === 'customer')} total={c.customer_total} locked={locked} onDelete={remove} />
      <ChargeTable title="Carrier pay" items={c.items.filter(i => i.side === 'carrier')} total={c.carrier_total} locked={false} onDelete={remove} />
      <form className="tms-reply" onSubmit={add}>
        <div className="tms-form-grid tms-form-grid-4">
          <div className="tms-field">
            <label htmlFor="ch-side">Add to</label>
            <select id="ch-side" value={side} onChange={e => switchSide(e.target.value)}>
              <option value="customer" disabled={locked}>Customer charges</option>
              <option value="carrier">Carrier pay</option>
            </select>
          </div>
          <div className="tms-field">
            <label htmlFor="ch-type">Charge code</label>
            <select id="ch-type" value={codeObj.code}
                    onChange={e => switchCode(CHARGE_CODES[side].find(x => x.code === e.target.value))}>
              {CHARGE_CODES[side].map(c => (
                <option key={c.code} value={c.code}>{c.code} — {c.label}{c.default_rate ? ` ($${c.default_rate})` : ''}</option>
              ))}
            </select>
          </div>
          <div className="tms-field">
            <label htmlFor="ch-desc">Description</label>
            <input id="ch-desc" value={desc} onChange={e => setDesc(e.target.value)} placeholder="e.g. 2 h at consignee" />
          </div>
          <div className="tms-field">
            <label htmlFor="ch-amt">Amount (USD)</label>
            <input id="ch-amt" type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} required />
          </div>
        </div>
        <button className="tms-btn secondary" disabled={busy || !amount || Number(amount) === 0 || (side === 'customer' && locked)}>Add charge</button>
        <ErrorNote error={error} />
      </form>
    </div>
  );
}

// ── Details and editing ──────────────────────────────────────────────

function Details({ s }) {
  const carrier = s.carrier;
  return (
    <KV items={[
      ['Customer', s.customer ? <Link to={`/tms/ops/customers/${s.customer.code}`}>{s.customer.name}</Link> : s.customer_code],
      ['Account', s.customer?.on_hold ? <span className="tms-status tms-s-bad">On hold</span> : 'In good standing'],
      ['Carrier', carrier ? <Link to={`/tms/ops/carriers/${carrier.code}`}>{s.carrier_name}</Link> : s.carrier_name],
      ['Carrier MC', carrier?.mc_number],
      ['Carrier email', s.carrier_email],
      ['Truck', s.truck_id ? s.truck_id : <span className="tms-inline-note warn">Not assigned</span>],
      ['Driver', s.driver_name ? s.driver_name : <span className="tms-inline-note warn">Not assigned</span>],
      ['Load', s.load_id],
      ['Commodity', s.commodity],
      ['Weight', s.weight_lbs ? `${Number(s.weight_lbs).toLocaleString()} lb` : null],
      ['Equipment', s.trailer],
      ['Distance', s.miles ? `${s.miles.toLocaleString()} mi` : null],
      ['Value', s.amount],
      ['BOL', s.bol],
      ['PO number', s.po_number],
      ['PRO number', s.pro_number],
      ['Customer reference', s.customer_ref],
      ['Booked from order', s.order_id ? <Link to={`/tms/ops/orders/${s.order_id}`}>{s.order_id}</Link> : null],
      ['Pickup appointment', fmtWindow(s.pickup_appt_start, s.pickup_appt_end)],
      ['Delivery appointment', fmtWindow(s.delivery_appt_start, s.delivery_appt_end)],
    ]} />
  );
}

const EDIT_FIELDS = ['truck_id', 'driver_name', 'carrier_code', 'trailer', 'po_number', 'pro_number', 'customer_ref',
  'pickup_appt_start', 'pickup_appt_end', 'delivery_appt_start', 'delivery_appt_end'];
const TIME_FIELDS = new Set(['pickup_appt_start', 'pickup_appt_end', 'delivery_appt_start', 'delivery_appt_end']);

function initialForm(s) {
  return Object.fromEntries(EDIT_FIELDS.map(f => [f, TIME_FIELDS.has(f) ? toPhxInput(s[f]) : (s[f] ?? '')]));
}

function EditShipment({ s, onDone, onCancel }) {
  const carriers = useLiveData('/api/carriers', 60000);
  const drivers = useLiveData('/api/drivers', 60000);
  const trucks = useLiveData('/api/trucks', 60000);
  const [form, setForm] = useState(() => initialForm(s));
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const start = initialForm(s);
  const changed = EDIT_FIELDS.filter(f => form[f] !== start[f]);
  const set = f => e => setForm(v => ({ ...v, [f]: e.target.value }));

  async function save(e) {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      const body = Object.fromEntries(changed.map(f => [f, TIME_FIELDS.has(f) ? fromPhxInput(form[f]) : form[f].trim()]));
      await api.patch(`/api/shipments/${s.id}`, { ...body, reason: reason.trim(), author: author() }, { auth: true });
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const input = (f, label, extra = {}) => (
    <div className="tms-field">
      <label htmlFor={`ed-${f}`}>{label}</label>
      <input id={`ed-${f}`} value={form[f]} onChange={set(f)} {...extra} />
    </div>
  );

  return (
    <form onSubmit={save}>
      <div className="tms-form-grid tms-form-grid-2">
        <div className="tms-field" style={{ gridColumn: '1 / -1' }}>
          <label htmlFor="ed-carrier_code">Carrier</label>
          <select id="ed-carrier_code" value={form.carrier_code} onChange={set('carrier_code')}>
            {!form.carrier_code && <option value="">Choose a carrier</option>}
            {(carriers.data || []).map(c => (
              <option key={c.code} value={c.code} disabled={c.status !== 'Active'}>
                {c.name}{c.status !== 'Active' ? ` (${c.status})` : ''}
              </option>
            ))}
          </select>
          {form.carrier_code !== start.carrier_code && (
            <span className="tms-sub">Carrier emails will go to the new carrier's address.</span>
          )}
        </div>
        {input('truck_id', 'Truck', { list: 'ed-trucks', placeholder: 'e.g. TRUCK-015' })}
        {input('driver_name', 'Driver', { list: 'ed-drivers' })}
        <datalist id="ed-trucks">{(trucks.data || []).filter(t => t.status === 'In service').map(t => <option key={t.id} value={t.id} />)}</datalist>
        <datalist id="ed-drivers">{(drivers.data || []).map(d => <option key={d.id} value={d.name} />)}</datalist>
        {input('pickup_appt_start', 'Pickup window opens', { type: 'datetime-local' })}
        {input('pickup_appt_end', 'Pickup window closes', { type: 'datetime-local' })}
        {input('delivery_appt_start', 'Delivery window opens', { type: 'datetime-local' })}
        {input('delivery_appt_end', 'Delivery window closes', { type: 'datetime-local' })}
        {input('po_number', 'PO number')}
        {input('pro_number', 'PRO number')}
        {input('customer_ref', 'Customer reference')}
        {input('trailer', 'Equipment', { list: 'ed-equip' })}
        <datalist id="ed-equip">{['Dry Van', 'Reefer', 'Flatbed', 'Step Deck'].map(t => <option key={t} value={t} />)}</datalist>
        <div className="tms-field" style={{ gridColumn: '1 / -1' }}>
          <label htmlFor="ed-reason">Reason for the change (saved as a note)</label>
          <input id="ed-reason" value={reason} onChange={e => setReason(e.target.value)} required
                 placeholder="e.g. Carrier confirmed new truck by phone" />
        </div>
      </div>
      <p className="tms-sub" style={{ marginBottom: 10 }}>Times are Phoenix time. {changed.length ? `${changed.length} field${changed.length > 1 ? 's' : ''} changed.` : 'Nothing changed yet.'}</p>
      <div className="tms-actions">
        <button className="tms-btn" disabled={saving || !changed.length || !reason.trim()}>{saving ? 'Saving' : 'Save changes'}</button>
        <button type="button" className="tms-btn secondary" onClick={onCancel}>Cancel</button>
      </div>
      <ErrorNote error={error} />
    </form>
  );
}

// ── Page ─────────────────────────────────────────────────────────────

export function OpsShipment() {
  const { id } = useParams();
  const ship = useLiveData(`/api/shipments/${encodeURIComponent(id)}`, 3000);
  const [tab, setTab] = useState('tracking');
  const [editing, setEditing] = useState(false);
  const s = ship.data;

  if (ship.error && !s) {
    return <PageHeader crumb={<Link to="/tms/ops/shipments">Shipments</Link>} title={id} subtitle="Couldn't load this shipment." />;
  }
  if (!s) return <p className="tms-empty">Loading shipment</p>;

  const label = (prefix, v) => (v && !v.toUpperCase().startsWith(prefix) ? `${prefix} ${v}` : v);
  const refs = [s.bol, label('PO', s.po_number), label('PRO', s.pro_number)].filter(Boolean).join(', ');

  return (
    <>
      <PageHeader crumb={<Link to="/tms/ops/shipments">Shipments</Link>} title={s.id}
                  subtitle={`${s.origin} to ${s.destination}, ${s.customer?.name || s.customer_code}. ${refs}`}>
        <ShipmentStatus status={s.status} />
        <LiveNote live={ship} />
      </PageHeader>
      <div className="tms-actions" style={{ marginBottom: 14 }}>
        <button className="tms-btn secondary small" onClick={() => setEditing(true)} disabled={editing}>Edit shipment</button>
        <a className="tms-btn secondary small" href={tmsUrl(`/api/shipments/${s.id}/print/bol`)} target="_blank" rel="noreferrer">Print BOL</a>
        <a className="tms-btn secondary small" href={tmsUrl(`/api/shipments/${s.id}/print/rate-confirmation`)} target="_blank" rel="noreferrer">Rate confirmation</a>
      </div>
      <div className="tms-grid-2">
        <div className="tms-panel">
          <RecordTabs tab={tab} onChange={setTab} tabs={[
            { id: 'tracking', label: 'Tracking' },
            { id: 'stops', label: 'Stops' },
            { id: 'check-calls', label: 'Check calls' },
            { id: 'documents', label: 'Documents' },
            { id: 'charges', label: 'Charges' },
            { id: 'notes', label: `Notes (${s.notes.length})` },
          ]} />
          <div className="tms-panel-b">
            {tab === 'tracking' && (
              <>
                {s.tracking_alert && <div className="tms-callout warn" style={{ marginBottom: 12 }}>{s.tracking_alert}</div>}
                <Timeline shipment={s} />
                {s.status !== 'Delivered' || !s.milestones.some(m => m.code === 'POD')
                  ? <AddMilestone shipment={s} onDone={ship.reload} /> : null}
              </>
            )}
            {tab === 'stops' && <StopsTab s={s} />}
            {tab === 'check-calls' && <CheckCallsTab s={s} />}
            {tab === 'documents' && <DocumentsTab s={s} onChange={ship.reload} />}
            {tab === 'charges' && <ChargesTab s={s} onChange={ship.reload} />}
            {tab === 'notes' && (
              <NotesPanel notes={s.notes} entityType="shipment" entityId={s.id} perspective="ops" onChange={ship.reload} />
            )}
          </div>
        </div>

        <section className="tms-panel">
          <div className="tms-panel-h"><h2>{editing ? 'Edit shipment' : 'Details'}</h2></div>
          <div className="tms-panel-b">
            {editing
              ? <EditShipment s={s} onCancel={() => setEditing(false)} onDone={() => { setEditing(false); ship.reload(); }} />
              : <Details s={s} />}
          </div>
        </section>
      </div>
    </>
  );
}
