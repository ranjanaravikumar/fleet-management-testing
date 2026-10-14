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
};

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
  email_received:     'Email received',
  asked_carrier:      'Asked carrier',
  data_sweep:         'Data sweep',
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
