import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveData, useNow } from '../../hooks/useLiveData';
import { fmtDateTime } from '../../api/tms';
import { ApiDown, LiveNote, PageHeader } from '../ui';
import { todayPhx } from '../lib';

const DAY = 86400000;
const PHX_OFFSET = '-07:00';

function barState(s) {
  if (s.tracking_alert) return 'exception';
  if (s.status === 'Delivered') return 'delivered';
  if (s.status === 'Booked') return 'booked';
  return 'moving';
}

/** Put bars that overlap in time on separate lanes inside one row. */
function stack(items) {
  const lanes = [];
  for (const it of [...items].sort((a, b) => a.start - b.start)) {
    let lane = lanes.findIndex(end => end <= it.start);
    if (lane === -1) { lane = lanes.length; lanes.push(0); }
    lanes[lane] = it.end;
    it.lane = lane;
  }
  return Math.max(1, lanes.length);
}

function buildRows(ships, trucks) {
  const ownTrucks = new Map(trucks.map(t => [t.id, t]));
  const rows = new Map();
  for (const t of trucks) {
    rows.set(t.id, { key: t.id, group: 'Our fleet', title: t.driver?.name || 'No driver', sub: `${t.id}${t.status !== 'In service' ? `, ${t.status.toLowerCase()}` : ''}`, down: t.status !== 'In service', items: [] });
  }
  for (const s of ships) {
    let key = s.truck_id;
    if (!key) {
      key = `none-${s.id}`;
      rows.set(key, { key, group: 'No truck assigned', title: s.carrier_name, sub: 'Needs a truck and driver', items: [] });
    } else if (!rows.has(key)) {
      rows.set(key, { key, group: ownTrucks.has(key) ? 'Our fleet' : 'Outside carriers', title: s.carrier_name, sub: `${key}, ${s.driver_name || 'no driver'}`, items: [] });
    }
    rows.get(key).items.push(s);
  }
  const order = ['No truck assigned', 'Our fleet', 'Outside carriers'];
  return [...rows.values()].sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || a.title.localeCompare(b.title));
}

export function OpsDispatch() {
  const ships = useLiveData('/api/shipments', 5000);
  const trucks = useLiveData('/api/trucks', 30000);
  const [offset, setOffset] = useState(-1);
  const now = useNow(60000);
  const navigate = useNavigate();

  const start = new Date(`${todayPhx()}T00:00:00${PHX_OFFSET}`).getTime() + offset * DAY;
  const days = 5;
  const end = start + days * DAY;
  const pct = t => ((Math.min(Math.max(t, start), end) - start) / (end - start)) * 100;

  const inRange = (ships.data || []).filter(s => {
    const a = new Date(s.pickup_appt_start || s.delivery_appt_start).getTime();
    const b = new Date(s.delivery_appt_end || s.delivery_appt_start || s.pickup_appt_end).getTime();
    return a && b && b >= start && a <= end;
  });
  const rows = buildRows(inRange, trucks.data || []);
  const dayLabels = Array.from({ length: days }, (_, i) => new Date(start + i * DAY + 12 * 3600000)
    .toLocaleDateString('en-US', { timeZone: 'America/Phoenix', weekday: 'short', month: 'short', day: 'numeric' }));

  return (
    <>
      <PageHeader title="Dispatch board" subtitle="Every truck and its loads over five days, Phoenix time.">
        <LiveNote live={ships} />
        <span className="tms-actions">
          <button className="tms-btn secondary small" onClick={() => setOffset(o => o - 1)}>Earlier</button>
          <button className="tms-btn secondary small" onClick={() => setOffset(-1)} disabled={offset === -1}>Today</button>
          <button className="tms-btn secondary small" onClick={() => setOffset(o => o + 1)}>Later</button>
        </span>
      </PageHeader>
      <ApiDown live={ships} />
      <div className="tms-legend" aria-label="Legend">
        <span className="booked">Booked</span><span className="moving">Picked up or moving</span>
        <span className="exception">Exception</span><span className="delivered">Delivered</span>
      </div>
      <div className="tms-panel tms-board" role="table" aria-label="Dispatch board">
        <div className="tms-board-row tms-board-head" role="row">
          <div className="tms-board-who" role="columnheader">Truck and driver</div>
          <div className="tms-board-track" role="columnheader">
            {dayLabels.map((d, i) => <div key={d} className="tms-board-day" style={{ left: `${(i / days) * 100}%`, width: `${100 / days}%` }}>{d}</div>)}
          </div>
        </div>
        {rows.map((r, i) => {
          const items = r.items.map(s => ({
            s, start: new Date(s.pickup_appt_start || s.delivery_appt_start).getTime(),
            end: new Date(s.delivery_appt_end || s.delivery_appt_start).getTime(),
          }));
          const lanes = stack(items);
          const header = i === 0 || rows[i - 1].group !== r.group
            ? <div className="tms-board-group" role="row"><span role="cell">{r.group}</span></div> : null;
          return (
            <div key={r.key}>
              {header}
              <div className={`tms-board-row${r.down ? ' down' : ''}`} role="row" style={{ '--lanes': lanes }}>
                <div className="tms-board-who" role="rowheader"><strong>{r.title}</strong><div className="tms-sub">{r.sub}</div></div>
                <div className="tms-board-track" role="cell">
                  {Array.from({ length: days - 1 }, (_, i) => <span key={i} className="tms-board-grid" style={{ left: `${((i + 1) / days) * 100}%` }} />)}
                  {now >= start && now <= end && <span className="tms-board-now" style={{ left: `${pct(now)}%` }} aria-hidden="true" />}
                  {items.length === 0 && <span className="tms-board-free">{r.down ? 'Out of service' : 'Available'}</span>}
                  {items.map(({ s, start: a, end: b, lane }) => (
                    <button key={s.id} type="button" className={`tms-bar ${barState(s)}`}
                            style={{ left: `${pct(a)}%`, width: `max(${pct(b) - pct(a)}%, 46px)`, top: `${6 + lane * 30}px` }}
                            title={`${s.id}: ${s.origin} to ${s.destination}. Pickup ${fmtDateTime(s.pickup_appt_start)}, delivery ${fmtDateTime(s.delivery_appt_start)}. ${s.tracking_alert || s.status}`}
                            onClick={() => navigate(`/tms/ops/shipments/${s.id}`)}>
                      <strong>{s.id}</strong> {s.origin.split(',')[0]} to {s.destination.split(',')[0]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
