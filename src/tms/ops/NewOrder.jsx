import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveData } from '../../hooks/useLiveData';
import { ErrorNote, PageHeader } from '../ui';
import { api, getSession } from '../lib';

const FREIGHT_CLASSES = ['50', '55', '60', '65', '70', '77.5', '85', '92.5', '100', '110', '125', '150', '175', '200', '250', '300', '400', '500'];

export function OpsNewOrder() {
  const navigate = useNavigate();
  const customers = useLiveData('/api/customers', 60000);
  const [f, setF] = useState({
    customer_code: '', origin_zip: '', origin_state: '', origin_country: 'US',
    dest_zip: '', dest_state: '', dest_country: 'US',
    weight_lbs: '', freight_class: '', pallet_count: '', commodity: '', skid_dims: '', po_number: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = k => e => setF(v => ({ ...v, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      const body = { author: getSession()?.name };
      for (const [k, v] of Object.entries(f)) {
        if (v.trim()) body[k] = v.trim();
      }
      const o = await api.post('/api/orders', body, { auth: true });
      navigate(`/tms/ops/orders/${o.id}`);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  const field = (k, label, extra = {}) => (
    <div className="tms-field">
      <label htmlFor={`no-${k}`}>{label}</label>
      <input id={`no-${k}`} value={f[k]} onChange={set(k)} {...extra} />
    </div>
  );

  return (
    <>
      <PageHeader crumb={<Link to="/tms/ops/orders">Orders</Link>} title="New order" subtitle="Enter a new order directly." />
      <div className="tms-panel" style={{ maxWidth: 740 }}>
        <div className="tms-panel-h"><h2>Order details</h2></div>
        <div className="tms-panel-b">
          <form onSubmit={submit}>
            <div className="tms-form-grid tms-form-grid-2">
              <div className="tms-field" style={{ gridColumn: '1 / -1' }}>
                <label htmlFor="no-customer_code">Customer</label>
                <select id="no-customer_code" value={f.customer_code} onChange={set('customer_code')} required>
                  <option value="">Choose a customer</option>
                  {(customers.data || []).map(c => (
                    <option key={c.code} value={c.code}>{c.name} ({c.code})</option>
                  ))}
                </select>
              </div>
              <div className="tms-field">
                <label>Origin</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input id="no-origin_zip" value={f.origin_zip} onChange={set('origin_zip')} placeholder="ZIP / Postal" style={{ flex: '1 1 90px' }} />
                  <input id="no-origin_state" value={f.origin_state} onChange={set('origin_state')} placeholder="State" style={{ flex: '0 0 60px' }} aria-label="Origin state" />
                  <input id="no-origin_country" value={f.origin_country} onChange={set('origin_country')} placeholder="Country" style={{ flex: '0 0 50px' }} aria-label="Origin country" />
                </div>
              </div>
              <div className="tms-field">
                <label>Destination</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input id="no-dest_zip" value={f.dest_zip} onChange={set('dest_zip')} placeholder="ZIP / Postal" style={{ flex: '1 1 90px' }} />
                  <input id="no-dest_state" value={f.dest_state} onChange={set('dest_state')} placeholder="State" style={{ flex: '0 0 60px' }} aria-label="Destination state" />
                  <input id="no-dest_country" value={f.dest_country} onChange={set('dest_country')} placeholder="Country" style={{ flex: '0 0 50px' }} aria-label="Destination country" />
                </div>
              </div>
              {field('weight_lbs', 'Weight (lb)', { type: 'number', min: '1', placeholder: '2500' })}
              <div className="tms-field">
                <label htmlFor="no-freight_class">Freight class</label>
                <select id="no-freight_class" value={f.freight_class} onChange={set('freight_class')}>
                  <option value="">Unknown</option>
                  {FREIGHT_CLASSES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              {field('pallet_count', 'Pallets', { type: 'number', min: '1' })}
              {field('skid_dims', 'Pallet dims', { placeholder: '48×40×50' })}
              {field('commodity', 'Commodity', { placeholder: 'e.g. Auto parts', list: 'no-commodities' })}
              <datalist id="no-commodities">
                {['Auto parts', 'Consumer goods', 'Food and beverage', 'Building materials',
                  'Industrial equipment', 'Electronics', 'Chemicals', 'Retail merchandise'].map(c => (
                  <option key={c} value={c} />
                ))}
              </datalist>
              {field('po_number', 'Customer PO number')}
            </div>
            <div className="tms-actions" style={{ marginTop: 8 }}>
              <button className="tms-btn" disabled={saving || !f.customer_code}>{saving ? 'Saving' : 'Create order'}</button>
              <Link className="tms-btn secondary" to="/tms/ops/orders">Cancel</Link>
            </div>
            <ErrorNote error={error} />
          </form>
        </div>
      </div>
    </>
  );
}
