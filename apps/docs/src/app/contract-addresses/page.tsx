export default function ContractAddressesPage() {
  return (
    <div className="docs-body" style={{ width: '100%' }}>
      <article className="docs-article">
        <div className="docs-page-breadcrumb">Developers</div>
        <div className="docs-page-title-row">
          <h1>Contract Addresses</h1>
        </div>
        <p className="docs-lead">
          All ArcenPay contracts are deployed on Sepolia ETH (chainId 11155111) for testnet.
          Base Mainnet addresses will be published at launch.
        </p>

        <h2 id="sepolia">Sepolia Testnet</h2>
        <table className="docs-table">
          <thead>
            <tr><th>Contract</th><th>Address</th></tr>
          </thead>
          <tbody>
            <tr><td>PlanFactory</td><td><code>0x18707519A062AbCC3E73fBd4150C3B30B241f536</code></td></tr>
            <tr><td>SubscriptionManager</td><td><code>0xA0Cf798816D4b9b9866b5704098F9C09F279c2C4</code></td></tr>
            <tr><td>AutopayModule</td><td><code>0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D</code></td></tr>
            <tr><td>SessionVault</td><td><code>0xdAC17F958D2ee523a2206206994597C13D831ec7</code></td></tr>
            <tr><td>ZKUsageVerifier</td><td><code>0x6B175474E89094C44Da98b954EedeAC495271d0F</code></td></tr>
            <tr><td>MirrorRegistry</td><td><code>0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599</code></td></tr>
          </tbody>
        </table>

        <div className="docs-callout info">
          <span className="docs-callout-icon">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
          </span>
          <div>Testnet contracts may be redeployed during active development. Always verify addresses against the latest release.</div>
        </div>
      </article>

      <nav className="docs-toc" aria-label="Table of contents">
        <div className="docs-toc-heading">On this page</div>
        <ul className="docs-toc-list">
          <li className="docs-toc-item active"><a href="#sepolia">Sepolia Testnet</a></li>
        </ul>
      </nav>
    </div>
  );
}
