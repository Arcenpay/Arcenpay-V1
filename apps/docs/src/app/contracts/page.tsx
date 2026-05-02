'use client';

export default function ContractsIndexPage() {
  const contracts = [
    {
      name: 'PlanFactory',
      href: '/contracts/plan-factory',
      desc: 'Plan creation and provider-level catalog registration.',
      surface: 'Subscriptions',
    },
    {
      name: 'SubscriptionRegistry',
      href: '/contracts/subscription-registry',
      desc: 'Subscription NFT lifecycle, renewal state, and access-oriented reads.',
      surface: 'Subscriptions',
    },
    {
      name: 'ERC7579AutopayModule',
      href: '/contracts/autopay-module',
      desc: 'Recurring pull execution for subscriber smart accounts.',
      surface: 'Subscriptions',
    },
    {
      name: 'FeeCollector',
      href: '/contracts/fee-collector',
      desc: 'Protocol fee accounting for subscriptions and usage settlement.',
      surface: 'Shared',
    },
    {
      name: 'SessionVault',
      href: '/contracts/session-vault',
      desc: 'Prefunded USDC balances for metered sessions.',
      surface: 'Usage Billing',
    },
    {
      name: 'ZKUsageVerifier',
      href: '/contracts/zk-usage-verifier',
      desc: 'Proof verification and settlement for session-based metering.',
      surface: 'Usage Billing',
    },
  ];

  return (
    <div className="docs-body" style={{ width: '100%' }}>
      <article className="docs-article">
        <div className="docs-page-breadcrumb">Contracts</div>
        <div className="docs-page-title-row"><h1>Contract Reference</h1></div>

        <p className="docs-lead" id="contracts">
          These are the core contracts that matter for the current Base
          Sepolia-first runtime. Some additional contracts still exist in the
          codebase as experimental or legacy work, but they are not the primary
          launch surface for subscriptions and hosted payments.
        </p>

        <div className="docs-callout info">
          <span className="docs-callout-icon">i</span>
          <div>
            Use the contract-specific pages for addresses and ABI context. The
            dashboard, hosted payments, and current docs are aligned to Base
            Sepolia as the main runtime chain.
          </div>
        </div>

        <h2 id="contract-list">Active contract surfaces</h2>
        <div className="docs-card-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
          {contracts.map((contract) => (
            <a key={contract.name} href={contract.href} className="docs-card">
              <div className="docs-card-kicker">{contract.surface}</div>
              <h3 className="docs-card-title">{contract.name}</h3>
              <p className="docs-card-text">{contract.desc}</p>
              <span className="docs-card-link">Open contract page →</span>
            </a>
          ))}
        </div>

        <h2 id="runtime-notes">Runtime notes</h2>
        <ul>
          <li>Recurring plans still rely on on-chain plan, registry, and autopay flows.</li>
          <li>Hosted one-time checkout is a dashboard/backend product layer that verifies direct USDC transfers and records ledger state.</li>
          <li>Cross-chain or legacy-contract surfaces should be treated as optional or secondary unless your deployment explicitly enables them.</li>
        </ul>
      </article>

      <nav className="docs-toc">
        <div className="docs-toc-heading">On this page</div>
        <ul className="docs-toc-list">
          <li className="docs-toc-item active"><a href="#contracts">Contract Reference</a></li>
          <li className="docs-toc-item"><a href="#contract-list">Active surfaces</a></li>
          <li className="docs-toc-item"><a href="#runtime-notes">Runtime notes</a></li>
        </ul>
      </nav>
    </div>
  );
}
