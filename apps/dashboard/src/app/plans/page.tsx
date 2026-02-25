// ============================================================
//  Provider Dashboard — Plans Management Page
//  PRD MEAP-009: Configure plans, view tiers, manage pricing
// ============================================================

'use client';

import { useState } from 'react';

interface Plan {
  id: number;
  name: string;
  tier: string;
  price: string;
  interval: string;
  active: boolean;
  subscribers: number;
}

const SAMPLE_PLANS: Plan[] = [
  { id: 1, name: 'Starter', tier: 'starter', price: '9.99', interval: 'Monthly', active: true, subscribers: 0 },
  { id: 2, name: 'Professional', tier: 'pro', price: '29.99', interval: 'Monthly', active: true, subscribers: 0 },
  { id: 3, name: 'Enterprise', tier: 'enterprise', price: '99.99', interval: 'Monthly', active: false, subscribers: 0 },
];

export default function PlansPage() {
  const [plans] = useState<Plan[]>(SAMPLE_PLANS);
  const [showCreate, setShowCreate] = useState(false);

  return (
    <>
      <div className="page-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1>Plans</h1>
            <p>Create and manage subscription plans via PlanFactory</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowCreate(!showCreate)}>
            + Create Plan
          </button>
        </div>
      </div>

      {showCreate && (
        <div className="data-table" style={{ marginBottom: 24 }}>
          <div className="table-header">
            <h3>New Plan</h3>
          </div>
          <div style={{ padding: 24, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <label style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>Plan Name</label>
              <input type="text" placeholder="e.g., Professional" style={{
                width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-primary)', border: '1px solid var(--border)',
                color: 'var(--text-primary)', fontSize: 14
              }} />
            </div>
            <div>
              <label style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>Tier</label>
              <select style={{
                width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-primary)', border: '1px solid var(--border)',
                color: 'var(--text-primary)', fontSize: 14
              }}>
                <option value="starter">Starter</option>
                <option value="pro">Professional</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>Price (USDC)</label>
              <input type="number" placeholder="29.99" step="0.01" style={{
                width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-primary)', border: '1px solid var(--border)',
                color: 'var(--text-primary)', fontSize: 14
              }} />
            </div>
            <div>
              <label style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>Billing Interval</label>
              <select style={{
                width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-primary)', border: '1px solid var(--border)',
                color: 'var(--text-primary)', fontSize: 14
              }}>
                <option value="2592000">Monthly (30 days)</option>
                <option value="7776000">Quarterly (90 days)</option>
                <option value="31536000">Annually (365 days)</option>
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 12, justifyContent: 'flex-end', paddingTop: 8 }}>
              <button className="btn" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="btn btn-primary">Deploy Plan to Chain</button>
            </div>
          </div>
        </div>
      )}

      <div className="data-table">
        <div className="table-header">
          <h3>All Plans</h3>
          <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
            {plans.length} plans configured
          </span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Plan</th>
              <th>Tier</th>
              <th>Price</th>
              <th>Interval</th>
              <th>Subscribers</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {plans.map((plan) => (
              <tr key={plan.id}>
                <td style={{ fontWeight: 600 }}>{plan.name}</td>
                <td><span className={`badge ${plan.tier}`}>{plan.tier}</span></td>
                <td>${plan.price} USDC</td>
                <td>{plan.interval}</td>
                <td>{plan.subscribers}</td>
                <td>
                  <span className={`badge ${plan.active ? 'active' : 'inactive'}`}>
                    {plan.active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td>
                  <button className="btn" style={{ padding: '4px 10px', fontSize: 13 }}>
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
