// Talks to the TMS API (backend/tms). The address comes from VITE_TMS_API_URL
// in a .env.local file; without it, the local backend is used.
export const TMS_API_URL = (import.meta.env.VITE_TMS_API_URL || 'http://localhost:8000').replace(/\/$/, '');

// The customer whose shipments the customer portal shows.
export const PORTAL_CUSTOMER = import.meta.env.VITE_PORTAL_CUSTOMER || 'NFAS';

export async function tmsGet(path, { signal } = {}) {
  const res = await fetch(TMS_API_URL + path, {
    signal,
    // Skips ngrok's browser warning page when the API is reached through a tunnel.
    headers: { 'ngrok-skip-browser-warning': '1' },
  });
  if (!res.ok) throw new Error(`${res.status} from ${path}`);
  return res.json();
}

// All demo times are Phoenix time, so show them that way wherever the viewer is.
const TZ = 'America/Phoenix';

export function fmtDateTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-US', {
    timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

export function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric' });
}

export function fmtTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
}

export function fmtWindow(start, end) {
  if (!start) return 'Not scheduled';
  return end ? `${fmtDateTime(start)} to ${fmtTime(end)}` : fmtDateTime(start);
}

export function timeAgo(iso, nowMs = Date.now()) {
  if (!iso) return '';
  const s = Math.max(0, Math.round((nowMs - new Date(iso).getTime()) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s} sec ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return fmtDateTime(iso);
}
