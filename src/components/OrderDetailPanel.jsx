import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { X, FileText, Package, ClipboardCheck, Receipt, Truck } from 'lucide-react';
import { INITIAL_LOADS, DRIVERS } from '../data/mockData';

// ── Deterministic mock helpers (no randomness across re-renders) ───────────
function seedFromString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}
function pick(seed, arr) {
  return arr[seed % arr.length];
}

const RECEIVER_NAMES = ['R. Martinez', 'J. Alvarez', 'T. Williams', 'K. Nguyen', 'D. Okafor', 'S. Brar', 'M. Leblanc'];
const CONDITIONS = ['No damage noted', 'Sealed — no damage', 'Minor pallet wear, contents intact'];

function docNumber(prefix, order) {
  return `${prefix}-${order.id.replace(/\D/g, '')}`;
}

function buildDocuments(order) {
  const docs = [{ id: `${order.id}-BOL`, type: 'BOL', label: 'Bill of Lading', icon: Package }];
  if (order.status === 'Delivered') {
    docs.push({ id: `${order.id}-POD`, type: 'POD', label: 'Proof of Delivery', icon: ClipboardCheck });
  }
  if (order.invoiceStatus !== 'Pending') {
    docs.push({ id: `${order.id}-INV`, type: 'Invoice', label: 'Invoice', icon: Receipt });
  }
  return docs;
}

const INVOICE_STAMP = {
  Paid: { text: 'PAID', color: '#16A34A' },
  Outstanding: { text: 'OUTSTANDING', color: '#D97706' },
  Overdue: { text: 'OVERDUE', color: '#DC2626' },
};

// ── "Paper" wrapper — mock documents render as a light printed page ────────
function Paper({ children }) {
  return (
    <div style={{
      background: '#F8F7F3', color: '#1a1a1a', borderRadius: '10px',
      padding: '32px 36px', minHeight: '480px', boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
      fontFamily: "'DM Sans', sans-serif", position: 'relative', overflow: 'hidden',
    }}>
      {children}
    </div>
  );
}

function DocHeader({ title, number, date }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid #1a1a1a', paddingBottom: '14px', marginBottom: '20px' }}>
      <div>
        <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: '20px', letterSpacing: '-0.5px' }}>{title}</div>
        <div style={{ fontSize: '11px', color: '#666', marginTop: '2px' }}>Qubiway Logistics · Fleet Operations</div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: '11px', color: '#666' }}>Document #</div>
        <div style={{ fontWeight: 700, fontSize: '13px' }}>{number}</div>
        <div style={{ fontSize: '11px', color: '#666', marginTop: '6px' }}>{date}</div>
      </div>
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div style={{ marginBottom: '4px' }}>
      <span style={{ fontSize: '10px', color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}: </span>
      <span style={{ fontSize: '12px', fontWeight: 600 }}>{value}</span>
    </div>
  );
}

function BOLPreview({ order, company }) {
  const [origin, destination] = order.route.split(' → ');
  return (
    <Paper>
      <DocHeader title="Bill of Lading" number={docNumber('BOL', order)} date={order.pickupDate} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
        <div style={{ background: '#EFEDE6', borderRadius: '8px', padding: '14px 16px' }}>
          <div style={{ fontSize: '10px', fontWeight: 700, color: '#666', textTransform: 'uppercase', marginBottom: '8px' }}>Shipper</div>
          <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '4px' }}>{company.Name}</div>
          <div style={{ fontSize: '11px', color: '#555' }}>{company.Address}</div>
          <div style={{ fontSize: '11px', color: '#555' }}>{company.City}, {company.Province} {company.Postal}</div>
        </div>
        <div style={{ background: '#EFEDE6', borderRadius: '8px', padding: '14px 16px' }}>
          <div style={{ fontSize: '10px', fontWeight: 700, color: '#666', textTransform: 'uppercase', marginBottom: '8px' }}>Consignee</div>
          <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '4px' }}>Receiving Dock</div>
          <div style={{ fontSize: '11px', color: '#555' }}>{destination}</div>
        </div>
      </div>
      <div style={{ marginBottom: '20px' }}>
        <Field label="Order" value={order.id} />
        <Field label="Route" value={order.route} />
        <Field label="Commodity" value={order.commodity} />
        <Field label="Weight" value={order.weight} />
        <Field label="Carrier" value="Qubiway Logistics" />
      </div>
      <div style={{ borderTop: '1px dashed #bbb', paddingTop: '16px', display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#666' }}>
        <span>Received in good order and condition, except as noted</span>
        <span style={{ borderBottom: '1px solid #999', minWidth: '160px', textAlign: 'center' }}>Signature</span>
      </div>
    </Paper>
  );
}

function PODPreview({ order }) {
  const seed = seedFromString(order.id);
  const [, destination] = order.route.split(' → ');
  const signedBy = pick(seed, RECEIVER_NAMES);
  const condition = pick(seed >> 3, CONDITIONS);
  const dock = (seed % 18) + 1;
  return (
    <Paper>
      <DocHeader title="Proof of Delivery" number={docNumber('POD', order)} date={order.deliveryDate} />
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px', color: '#16A34A' }}>
        <ClipboardCheck size={18} />
        <span style={{ fontWeight: 700, fontSize: '13px' }}>Delivery Confirmed</span>
      </div>
      <div style={{ marginBottom: '20px' }}>
        <Field label="Order" value={order.id} />
        <Field label="Delivered To" value={destination} />
        <Field label="Delivered On" value={`${order.deliveryDate}`} />
        <Field label="Dock / Bay" value={`#${dock}`} />
        <Field label="Signed By" value={signedBy} />
        <Field label="Condition" value={condition} />
      </div>
      <div style={{ borderTop: '1px dashed #bbb', paddingTop: '16px', display: 'flex', justifyContent: 'flex-end' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontFamily: 'cursive', fontSize: '20px', borderBottom: '1px solid #999', minWidth: '180px', paddingBottom: '4px' }}>{signedBy}</div>
          <div style={{ fontSize: '10px', color: '#888', marginTop: '4px' }}>Receiver Signature</div>
        </div>
      </div>
    </Paper>
  );
}

function InvoicePreview({ order, company }) {
  const stamp = INVOICE_STAMP[order.invoiceStatus] || INVOICE_STAMP.Outstanding;
  return (
    <Paper>
      <DocHeader title="Invoice" number={docNumber('INV', order)} date={order.deliveryDate || order.pickupDate} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', marginBottom: '20px' }}>
        <div>
          <div style={{ fontSize: '10px', fontWeight: 700, color: '#666', textTransform: 'uppercase', marginBottom: '6px' }}>Bill To</div>
          <div style={{ fontWeight: 700, fontSize: '13px' }}>{company.Name}</div>
          <div style={{ fontSize: '11px', color: '#555' }}>{company.Address}, {company.City}, {company.Province} {company.Postal}</div>
          <div style={{ fontSize: '11px', color: '#555', marginTop: '2px' }}>Terms: {company.Termcode || 'Due on receipt'}</div>
        </div>
        {stamp && (
          <div style={{
            flexShrink: 0, transform: 'rotate(-8deg)', border: `3px solid ${stamp.color}`, color: stamp.color,
            fontWeight: 800, fontSize: '14px', letterSpacing: '2px', padding: '6px 14px',
            borderRadius: '6px', opacity: 0.85, marginTop: '4px',
          }}>
            {stamp.text}
          </div>
        )}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', marginBottom: '16px' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #1a1a1a' }}>
            <th style={{ textAlign: 'left', padding: '6px 0', fontSize: '10px', textTransform: 'uppercase', color: '#666' }}>Description</th>
            <th style={{ textAlign: 'right', padding: '6px 0', fontSize: '10px', textTransform: 'uppercase', color: '#666' }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr style={{ borderBottom: '1px solid #ddd' }}>
            <td style={{ padding: '8px 0' }}>Freight charges — {order.route} ({order.commodity}, {order.weight})</td>
            <td style={{ padding: '8px 0', textAlign: 'right' }}>${order.rate.toLocaleString()}</td>
          </tr>
        </tbody>
      </table>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '20px' }}>
        <div style={{ minWidth: '200px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: '15px', borderTop: '2px solid #1a1a1a', paddingTop: '8px' }}>
            <span>Total Due</span>
            <span>${order.invoiceAmount.toLocaleString()}</span>
          </div>
        </div>
      </div>
      <div style={{ fontSize: '10px', color: '#888' }}>Reference: Order {order.id} · Account {company.Code}</div>
    </Paper>
  );
}

function DocumentPreview({ doc, order, company }) {
  if (!doc) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', color: 'var(--muted)', gap: '10px' }}>
        <FileText size={32} style={{ opacity: 0.4 }} />
        <p style={{ fontSize: '13px' }}>No documents available for this order.</p>
      </div>
    );
  }
  if (doc.type === 'BOL') return <BOLPreview order={order} company={company} />;
  if (doc.type === 'POD') return <PODPreview order={order} company={company} />;
  if (doc.type === 'Invoice') return <InvoicePreview order={order} company={company} />;
  return null;
}

export default function OrderDetailPanel({ order, company, onClose }) {
  const navigate = useNavigate();
  const documents = buildDocuments(order);
  const [selectedDocId, setSelectedDocId] = useState(documents[0]?.id ?? null);
  const selectedDoc = documents.find(d => d.id === selectedDocId) ?? null;

  const orderStatusColor = order.status === 'Delivered' ? 'var(--green)' : order.status === 'In Transit' ? 'var(--blue)' : order.status === 'Blocked' ? 'var(--red)' : 'var(--amber)';
  const INVOICE_BADGE = { Paid: 'green', Outstanding: 'amber', Overdue: 'red', Pending: 'amber' };

  // If this order corresponds to a real Dispatch Board load, surface its live state.
  const liveLoad = order.loadId ? INITIAL_LOADS.find(l => l.id === order.loadId) : null;
  const liveDriver = liveLoad?.driverId ? DRIVERS.find(d => d.id === liveLoad.driverId) : null;
  const DISPATCH_STATUS_COLOR = { blocked: 'var(--red)', needs_input: 'var(--amber)', ready: 'var(--blue)', assigned: 'var(--green)', delivered: 'var(--muted)' };

  // #db-panel animates its slide-in with a CSS transform, which makes it the
  // containing block for any position:fixed descendant — confining a plain
  // fixed overlay to the content area instead of the real viewport. Portal
  // straight to document.body to escape that ancestor entirely.
  return createPortal((
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9100, backdropFilter: 'blur(4px)' }} />
      <div style={{
        position: 'fixed', top: 0, right: 0, height: '100vh', width: 'min(96vw, 1040px)', zIndex: 9200,
        background: 'rgba(13,17,23,0.98)', backdropFilter: 'blur(24px)', borderLeft: '1px solid var(--border)',
        boxShadow: '-16px 0 48px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column',
        animation: 'slideInRight 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
      }}>
        {/* Header */}
        <div style={{ padding: '20px 28px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '2px' }}>Order Detail</div>
            <h3 style={{ margin: 0 }}>{order.id}</h3>
          </div>
          <button onClick={onClose} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '8px', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--muted)' }}>
            <X size={16} />
          </button>
        </div>

        {/* Body — two panes */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* Left: order summary + documents list */}
          <div style={{ width: '320px', flexShrink: 0, borderRight: '1px solid var(--border)', overflowY: 'auto', padding: '20px' }}>
            <div className="glass-card" style={{ marginBottom: '20px' }}>
              <div style={{ fontSize: '11px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '12px' }}>Order Summary</div>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
                <span style={{ color: orderStatusColor, fontWeight: 700, fontSize: '11px', textTransform: 'uppercase', alignSelf: 'center' }}>{order.status}</span>
                <span className={`badge ${INVOICE_BADGE[order.invoiceStatus] || 'amber'}`}>{order.invoiceStatus.toUpperCase()}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div className="tm-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '4px', gridColumn: '1 / -1' }}>
                  <span className="tm-label">Route</span>
                  <span className="tm-val" style={{ fontFamily: 'monospace', fontSize: '12px' }}>{order.route}</span>
                </div>
                <div className="tm-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
                  <span className="tm-label">Commodity</span>
                  <span className="tm-val" style={{ fontSize: '13px' }}>{order.commodity}</span>
                </div>
                <div className="tm-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
                  <span className="tm-label">Weight</span>
                  <span className="tm-val" style={{ fontSize: '13px' }}>{order.weight}</span>
                </div>
                <div className="tm-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
                  <span className="tm-label">Rate</span>
                  <span className="tm-val" style={{ fontSize: '13px' }}>${order.rate.toLocaleString()}</span>
                </div>
                <div className="tm-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
                  <span className="tm-label">Pickup</span>
                  <span className="tm-val" style={{ fontSize: '13px' }}>{order.pickupDate}</span>
                </div>
                <div className="tm-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '4px', gridColumn: '1 / -1' }}>
                  <span className="tm-label">Delivery</span>
                  <span className="tm-val" style={{ fontSize: '13px' }}>{order.deliveryDate}</span>
                </div>
              </div>
            </div>

            {liveLoad && (
              <div className="glass-card" style={{ marginBottom: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                  <Truck size={14} color="var(--amber)" />
                  <span style={{ fontSize: '11px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '1px' }}>Live Dispatch — Load #{liveLoad.id}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                  <span style={{ color: DISPATCH_STATUS_COLOR[liveLoad.status] || 'var(--muted)', fontWeight: 700, fontSize: '12px', textTransform: 'uppercase' }}>
                    {liveLoad.status.replace('_', ' ')}
                  </span>
                  {liveDriver && <span style={{ fontSize: '12px', color: 'var(--muted)' }}>· {liveDriver.name} · {liveDriver.truck}</span>}
                </div>
                {liveLoad.blockReason && (
                  <div style={{ background: 'var(--red-dim)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '8px', padding: '8px 12px', marginBottom: '12px' }}>
                    <p style={{ color: 'var(--red)', fontSize: '11px', fontWeight: 600 }}>{liveLoad.blockReason}</p>
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <button className="btn secondary" style={{ fontSize: '11px' }} onClick={() => navigate('/dispatch')}>
                    View in Dispatch Board →
                  </button>
                  {liveDriver && (
                    <button className="btn secondary" style={{ fontSize: '11px' }} onClick={() => navigate(`/fleet-twin?truck=${liveDriver.truck}`)}>
                      View in 3D Fleet Twin →
                    </button>
                  )}
                </div>
              </div>
            )}

            <div style={{ fontSize: '11px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '12px' }}>
              Documents {documents.length > 0 && `(${documents.length})`}
            </div>
            {documents.length === 0 ? (
              <p style={{ fontSize: '12px', color: 'var(--muted)' }}>No documents available for this order yet.</p>
            ) : (
              documents.map(doc => {
                const Icon = doc.icon;
                const active = doc.id === selectedDocId;
                return (
                  <button
                    key={doc.id}
                    onClick={() => setSelectedDocId(doc.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '10px', width: '100%',
                      padding: '12px 14px', marginBottom: '8px', borderRadius: '10px',
                      background: active ? 'rgba(245,158,11,0.1)' : 'var(--surface2)',
                      border: active ? '1px solid var(--amber-border)' : '1px solid var(--border2)',
                      color: active ? 'var(--amber)' : 'var(--text)',
                      cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s',
                    }}
                  >
                    <Icon size={15} />
                    <span style={{ fontSize: '13px', fontWeight: 600 }}>{doc.label}</span>
                  </button>
                );
              })
            )}
          </div>

          {/* Right: document preview */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '28px' }}>
            <DocumentPreview doc={selectedDoc} order={order} company={company} />
          </div>
        </div>
      </div>
    </>
  ), document.body);
}
