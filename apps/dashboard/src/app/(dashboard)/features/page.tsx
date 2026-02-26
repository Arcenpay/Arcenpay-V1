// ============================================================
//  Provider Dashboard — Feature Flags Page
//  PRD MEAP-009: Configure feature flags per plan tier
//  Feature flags stored in Tableland (PRD Section 3.1.2)
// ============================================================

'use client';

import { useState } from 'react';

interface FeatureFlag {
  key: string;
  description: string;
  tiers: Record<string, boolean>;
}

const DEFAULT_FLAGS: FeatureFlag[] = [
  {
    key: 'analytics_dashboard',
    description: 'Access to analytics dashboard with charts and exports',
    tiers: { starter: false, pro: true, enterprise: true },
  },
  {
    key: 'api_access',
    description: 'Programmatic API access with key management',
    tiers: { starter: false, pro: true, enterprise: true },
  },
  {
    key: 'custom_branding',
    description: 'White-label branding and custom themes',
    tiers: { starter: false, pro: false, enterprise: true },
  },
  {
    key: 'priority_support',
    description: 'Priority support with 24/7 SLA',
    tiers: { starter: false, pro: false, enterprise: true },
  },
  {
    key: 'webhook_integration',
    description: 'Real-time webhook notifications for events',
    tiers: { starter: true, pro: true, enterprise: true },
  },
  {
    key: 'multi_user',
    description: 'Team management with role-based access control',
    tiers: { starter: false, pro: true, enterprise: true },
  },
];

const TIERS = ['starter', 'pro', 'enterprise'];

export default function FeaturesPage() {
  const [flags, setFlags] = useState<FeatureFlag[]>(DEFAULT_FLAGS);

  const toggleFlag = (flagKey: string, tier: string) => {
    setFlags((prev) =>
      prev.map((f) =>
        f.key === flagKey
          ? { ...f, tiers: { ...f.tiers, [tier]: !f.tiers[tier] } }
          : f
      )
    );
  };

  return (
    <>
      <div className="page-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1>Feature Flags</h1>
            <p>Configure feature access per plan tier — synced to Tableland</p>
          </div>
          <button className="btn btn-primary">+ Add Flag</button>
        </div>
      </div>

      <div className="data-table">
        <div className="table-header">
          <h3>Feature Matrix</h3>
          <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
            {flags.length} flags × {TIERS.length} tiers
          </span>
        </div>
        <table>
          <thead>
            <tr>
              <th style={{ width: '30%' }}>Feature</th>
              <th>Description</th>
              {TIERS.map((tier) => (
                <th key={tier} style={{ textAlign: 'center' }}>
                  <span className={`badge ${tier}`}>{tier}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {flags.map((flag) => (
              <tr key={flag.key}>
                <td>
                  <span style={{ fontFamily: "'SF Mono', 'Fira Code', monospace", color: 'var(--accent)', fontSize: 13 }}>
                    {flag.key}
                  </span>
                </td>
                <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                  {flag.description}
                </td>
                {TIERS.map((tier) => (
                  <td key={tier} style={{ textAlign: 'center' }}>
                    <div
                      className={`toggle ${flag.tiers[tier] ? 'on' : ''}`}
                      onClick={() => toggleFlag(flag.key, tier)}
                      style={{ display: 'inline-block' }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 24 }}>
        <div className="flags-grid">
          {flags.map((flag) => (
            <div key={flag.key} className="flag-card">
              <div className="flag-header">
                <span className="flag-key">{flag.key}</span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {Object.values(flag.tiers).filter(Boolean).length}/{TIERS.length} tiers
                </span>
              </div>
              <div className="flag-desc">{flag.description}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
