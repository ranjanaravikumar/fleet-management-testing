import { TMS_API_URL, PORTAL_CUSTOMER } from '../api/tms';

export { PORTAL_CUSTOMER };

// ── Session: who is signed in to the demo ────────────────────────────
// Customers need no key. Operations users enter the TMS API key, which
// the console sends on anything that changes data.

export function getSession() {
  try { return JSON.parse(sessionStorage.getItem('tms-session')) || null; } catch { return null; }
}
export function setSession(session) {
  if (session) sessionStorage.setItem('tms-session', JSON.stringify(session));
  else sessionStorage.removeItem('tms-session');
}

async function send(method, path, body, { auth = false } = {}) {
  const headers = { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': '1' };
  if (auth) headers['X-API-Key'] = getSession()?.key || '';
  const res = await fetch(TMS_API_URL + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = Array.isArray(data.detail) ? data.detail.map(d => d.msg).join('; ') : data.detail;
    throw new Error(detail || `Request failed (${res.status})`);
  }
  return data;
}
export const api = {
  get: (path, opts) => send('GET', path, null, opts),
  post: (path, body, opts) => send('POST', path, body, opts),
  patch: (path, body, opts) => send('PATCH', path, body, opts),
  del: (path, opts) => send('DELETE', path, null, opts),
};

/** Full URL for a TMS page opened in a new tab (printable BOL, a document). */
export function tmsUrl(path) {
  return TMS_API_URL + path;
}

// ── Phoenix time in form fields ──────────────────────────────────────
// Phoenix is UTC-7 all year (no daylight saving), so a datetime-local value
// can be converted exactly, whatever time zone the browser is in.

export function toPhxInput(iso) {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() - 7 * 3600 * 1000);
  return d.toISOString().slice(0, 16);
}
export function fromPhxInput(value) {
  return value ? `${value}:00-07:00` : null;
}
export function phxDay(iso) {
  return iso ? toPhxInput(iso).slice(0, 10) : '';
}
export function todayPhx() {
  return phxDay(new Date().toISOString());
}

// ── Money ────────────────────────────────────────────────────────────

export function money(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '';
  return Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export const INVOICE_STATUS = {
  'Not invoiced': 'tms-s-muted',
  'Invoiced': 'tms-s-info',
  'Paid': 'tms-s-ok',
};

/** Download rows as a CSV file. columns: [{ label, value: row => text }] */
export function downloadCsv(filename, columns, rows) {
  const esc = v => {
    const t = String(v ?? '');
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const text = [columns.map(c => esc(c.label)).join(','),
    ...rows.map(r => columns.map(c => esc(c.value(r))).join(','))].join('\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

// ── Status vocabulary, shared by every screen ────────────────────────

export const SHIPMENT_STATUS = {
  'Booked':      'tms-s-muted',
  'At Pickup':   'tms-s-info',
  'In Transit':  'tms-s-info',
  'At Delivery': 'tms-s-info',
  'Delivered':   'tms-s-ok',
};

// Note tags, as shown in a record's Notes tab.
export const NOTE_ACTION = {
  note:               'Note',
  message:            'Message',
  update:             'Record updated',
  milestone:          'Tracking update',
  order_submitted:    'Quote request',
  order_instructions: 'Instructions',
  case_request:       'Request',
  case_reply:         'Reply',
  problem_detected:   'Problem detected',
  handoff:            'Needs a person',
  conflict:           'Left alone',
  email_received:     'Email received',
  asked_carrier:      'Asked carrier',
  data_sweep:         'Data sweep',
  document:           'Document',
  charge:             'Charges',
  invoice:            'Billing',
  booked:             'Booked',
};

export const MILESTONE_CODES = [
  { code: 'ARRSHIP', label: 'Arrived at shipper' },
  { code: 'PICK', label: 'Picked up' },
  { code: 'INTRANSIT', label: 'In transit (check call)' },
  { code: 'ARRCONSIGNEE', label: 'Arrived at consignee' },
  { code: 'DELV', label: 'Delivered' },
  { code: 'POD', label: 'Proof of delivery uploaded' },
];

// ── Order formatting ─────────────────────────────────────────────────

export function place(zip, state, country) {
  return [zip, state, country].filter(Boolean).join(', ');
}

export function lane(o) {
  return `${place(o.origin_zip, o.origin_state, o.origin_country)} to ${place(o.dest_zip, o.dest_state, o.dest_country)}`;
}

export function weight(o) {
  return Number.isFinite(Number(o.weight_lbs)) && o.weight_lbs !== '' ? `${Number(o.weight_lbs).toLocaleString()} lb` : o.weight_lbs;
}

export function initials(name = '') {
  return name.split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

/** Insurance standing from days left: label and status class. */
export function insuranceState(days) {
  if (days === null || days === undefined) return { label: 'No certificate on file', cls: 'tms-s-bad' };
  if (days < 0) return { label: `Expired ${-days} days ago`, cls: 'tms-s-bad' };
  if (days <= 30) return { label: `Expires in ${days} days`, cls: 'tms-s-warn' };
  return { label: 'Current', cls: 'tms-s-ok' };
}
