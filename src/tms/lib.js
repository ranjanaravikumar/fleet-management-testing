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

export const CASE_STATUS = {
  new:               { label: 'New',                  tone: 'tms-s-bad' },
  in_progress:       { label: 'Agent working',        tone: 'tms-s-agent' },
  awaiting_carrier:  { label: 'Waiting on carrier',   tone: 'tms-s-warn' },
  awaiting_customer: { label: 'Waiting on customer',  tone: 'tms-s-warn' },
  needs_human:       { label: 'Needs a person',       tone: 'tms-s-bad' },
  resolved:          { label: 'Resolved',             tone: 'tms-s-ok' },
};

export const HELP_TOPICS = [
  { id: 'status_update',  label: 'Where is my shipment?',    for: 'shipment' },
  { id: 'truck_number',   label: 'Need the truck number',    for: 'shipment' },
  { id: 'change_request', label: 'Change a delivery detail', for: 'shipment' },
  { id: 'quote_question', label: 'Question about my quote',  for: 'order' },
  { id: 'other',          label: 'Something else',           for: 'both' },
];

export const RECOMMENDATION = {
  answer_from_tms: { label: 'On track',             tone: 'tms-s-ok' },
  fix_internally:  { label: 'Fix from TMS records', tone: 'tms-s-info' },
  ask_carrier:     { label: 'Ask the carrier',      tone: 'tms-s-warn' },
  needs_human:     { label: 'Needs a person',       tone: 'tms-s-bad' },
};

export const NOTE_ACTION = {
  case_opened:      'Case opened',
  case_status:      'Case status',
  customer_replied: 'Customer replied',
  replied_customer: 'Replied',
  milestone:        'Milestone',
  update:           'Record updated',
  asked_carrier:    'Asked carrier',
  handoff:          'Handed off',
  data_sweep:       'Data sweep',
  email_received:   'Email received',
};

export function initials(name = '') {
  return name.split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase();
}
