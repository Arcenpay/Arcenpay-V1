'use client';

export default function ChangelogPage() {
  const updates = [
    {
      version: 'v1.0.4',
      date: 'March 18, 2024',
      title: 'ZKVUB Mainnet Alpha',
      changes: [
        'Launched ZKUsageVerifier for automated AI agent settlements.',
        'Added @arcenpay/agent SDK for autonomous top-ups.',
        'Integrated Lit Protocol for encrypted feature flags.'
      ]
    },
    {
      version: 'v1.0.3',
      date: 'February 25, 2024',
      title: 'Cross-Chain Mirroring',
      changes: [
        'Added MirrorRegistry for subscription state mirroring via Axelar.',
        'Launched supports for Base and Arbitrum testnets.',
        'Improved PricingTable component UI.'
      ]
    },
    {
      version: 'v1.0.0',
      date: 'January 10, 2024',
      title: 'ArcenPay Protocol Launch',
      changes: [
        'Initial release of PlanFactory and SubscriptionRegistry.',
        'ERC-5643 implementation for time-bound NFTs.',
        'Launched @arcenpay/react SDK.'
      ]
    }
  ];

  return (
    <div className="docs-body" style={{ width: '100%' }}>
      <article className="docs-article">
        <div className="docs-page-breadcrumb">Resources</div>
        <div className="docs-page-title-row"><h1>Changelog</h1></div>

        <p className="docs-lead">
          All the latest updates, fixes, and improvements to the ArcenPay protocol and SDKs.
        </p>

        <div className="docs-changelog" style={{ marginTop: '40px' }}>
          {updates.map((update, i) => (
            <div key={i} className="docs-changelog-entry" style={{ marginBottom: '64px', position: 'relative', paddingLeft: '32px', borderLeft: '1px solid #f3f4f6' }}>
              <div style={{ position: 'absolute', left: '-5px', top: '8px', width: '9px', height: '9px', borderRadius: '50%', backgroundColor: '#2563eb', border: '2px solid #ffffff' }} />
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#2563eb', marginBottom: '4px' }}>{update.version} — {update.date}</div>
              <h2 style={{ fontSize: '20px', marginTop: '0', marginBottom: '16px' }}>{update.title}</h2>
              <ul style={{ paddingLeft: '20px', color: '#4b5563', lineHeight: '1.6' }}>
                {update.changes.map((change, j) => (
                  <li key={j} style={{ marginBottom: '8px' }}>{change}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </article>

      <nav className="docs-toc">
        <div className="docs-toc-heading">Versions</div>
        <ul className="docs-toc-list">
          {updates.map((u, i) => (
            <li key={i} className="docs-toc-item"><a href={`#${u.version}`}>{u.version}</a></li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
