import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useLiveData } from '../../hooks/useLiveData';
import { fmtDateTime, fmtWindow } from '../../api/tms';
import { ApiDown, LiveNote, PageHeader, ShipmentStatus } from '../ui';

// Coordinates for the cities in the demo data. A real TMS geocodes addresses;
// this table keeps the demo self-contained. Add a city here if a new one shows up.
const CITY = {
  'Chicago, IL': [41.8781, -87.6298], 'Dallas, TX': [32.7767, -96.797], 'Kansas City, MO': [39.0997, -94.5786],
  'Phoenix, AZ': [33.4484, -112.074], 'Denver, CO': [39.7392, -104.9903], 'Flagstaff, AZ': [35.1983, -111.6513],
  'Toronto, ON': [43.6532, -79.3832], 'Buffalo, NY': [42.8864, -78.8784], 'Fort Erie, ON': [42.9018, -78.9722],
  'Tucson, AZ': [32.2226, -110.9747], 'El Paso, TX': [31.7619, -106.485], 'Lordsburg, NM': [32.3504, -108.7087],
  'Los Angeles, CA': [34.0522, -118.2437], 'Mesa, AZ': [33.4152, -111.8315], 'Albuquerque, NM': [35.0844, -106.6504],
  'Las Cruces, NM': [32.3199, -106.7637], 'Columbus, OH': [39.9612, -82.9988], 'Indianapolis, IN': [39.7684, -86.1581],
  'Las Vegas, NV': [36.1699, -115.1398], 'Tempe, AZ': [33.4255, -111.94], 'San Diego, CA': [32.7157, -117.1611],
  'Atlanta, GA': [33.749, -84.388], 'Miami, FL': [25.7617, -80.1918], 'Seattle, WA': [47.6062, -122.3321],
  'Houston, TX': [29.7604, -95.3698], 'Glendale, AZ': [33.5387, -112.186], 'Scottsdale, AZ': [33.4942, -111.9261],
};

function lastPosition(s) {
  const located = [...s.milestones].reverse().find(m => m.location && CITY[m.location]);
  return located ? { city: located.location, at: located.event_time, label: located.label } : { city: s.origin, at: null, label: 'Not picked up yet' };
}

function icon(state) {
  return L.divIcon({ className: '', html: `<span class="tms-pin ${state}"></span>`, iconSize: [16, 16], iconAnchor: [8, 8] });
}

function FlyTo({ target }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo(target, 6, { duration: 0.6 });
  }, [map, target]);
  return null;
}

export function OpsMap() {
  const ships = useLiveData('/api/shipments?status=active', 10000);
  const [selected, setSelected] = useState(null);
  const rows = (ships.data || []).map(s => ({ s, pos: lastPosition(s) }));
  const mapped = rows.filter(r => CITY[r.pos.city] && CITY[r.s.destination]);
  const missing = rows.length - mapped.length;
  const target = selected ? CITY[mapped.find(r => r.s.id === selected)?.pos.city] : null;

  return (
    <>
      <PageHeader title="Map" subtitle="Active shipments at their last reported location.">
        <LiveNote live={ships} />
      </PageHeader>
      <ApiDown live={ships} />
      <div className="tms-map-layout">
        <div className="tms-panel tms-map">
          <MapContainer center={[37.5, -100]} zoom={4} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
            <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                       url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                       maxZoom={19} />
            <FlyTo target={target} />
            {mapped.map(({ s, pos }) => {
              const state = s.tracking_alert ? 'exception' : s.status === 'Booked' ? 'booked' : 'moving';
              const here = CITY[pos.city];
              return (
                <Fragment key={s.id}>
                  <Polyline positions={[CITY[s.origin] || here, here]} pathOptions={{ color: '#1B5FCC', weight: 2, opacity: 0.55 }} />
                  <Polyline positions={[here, CITY[s.destination]]} pathOptions={{ color: '#7C8996', weight: 2, opacity: 0.6, dashArray: '5 6' }} />
                  <Marker position={here} icon={icon(state)} eventHandlers={{ click: () => setSelected(s.id) }}>
                    <Popup>
                      <strong>{s.id}</strong>, {s.origin} to {s.destination}<br />
                      {pos.label}{pos.at ? `, ${fmtDateTime(pos.at)}` : ''}<br />
                      {s.tracking_alert && <><b>{s.tracking_alert}</b><br /></>}
                      <Link to={`/tms/ops/shipments/${s.id}`}>Open shipment</Link>
                    </Popup>
                  </Marker>
                </Fragment>
              );
            })}
          </MapContainer>
        </div>
        <section className="tms-panel tms-map-list">
          <div className="tms-panel-h"><h2>Active shipments</h2><span className="tms-sub">{rows.length}</span></div>
          <ul>
            {rows.map(({ s, pos }) => (
              <li key={s.id} className={selected === s.id ? 'on' : ''}>
                <button type="button" onClick={() => setSelected(s.id)} disabled={!CITY[pos.city]}>
                  <span className="tms-id">{s.id}</span> <ShipmentStatus status={s.status} />
                  <div className="tms-sub">{s.origin} to {s.destination}</div>
                  <div className="tms-sub">Last seen: {pos.city}{pos.at ? `, ${fmtDateTime(pos.at)}` : ''}</div>
                  {s.tracking_alert && <div className="tms-inline-note warn">{s.tracking_alert}</div>}
                  <div className="tms-sub">Delivery {fmtWindow(s.delivery_appt_start, s.delivery_appt_end)}</div>
                </button>
                <Link to={`/tms/ops/shipments/${s.id}`} className="tms-map-open">Open</Link>
              </li>
            ))}
          </ul>
          {missing > 0 && <p className="tms-sub" style={{ padding: '8px 14px' }}>{missing} shipment{missing > 1 ? 's' : ''} not on the map: the city isn't in the map's list yet.</p>}
        </section>
      </div>
    </>
  );
}
