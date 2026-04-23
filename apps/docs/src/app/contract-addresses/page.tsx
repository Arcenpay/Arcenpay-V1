import { TESTNET_NETWORK_ROWS } from "@/lib/testnet-deployments";

export default function ContractAddressesPage() {
  const contractEntries = [
    { name: "PlanFactory", key: "planFactory" },
    { name: "SubscriptionRegistry", key: "subscriptionRegistry" },
    { name: "AutopayModule", key: "autopayModule" },
    { name: "FeeCollector", key: "feeCollector" },
    { name: "SessionVault", key: "sessionVault" },
    { name: "ZKUsageVerifier", key: "zkUsageVerifier" },
    { name: "MirrorRegistry", key: "mirrorRegistry" },
  ] as const;

  return (
    <div className="docs-body" style={{ width: '100%' }}>
      <article className="docs-article">
        <div className="docs-page-breadcrumb">Developers</div>
        <div className="docs-page-title-row">
          <h1>Contract Addresses</h1>
        </div>
        <p className="docs-lead">
          ArcenPay testnet contracts are live on Ethereum Sepolia and Base Sepolia.
          Base Mainnet addresses will be published when production deployment is ready.
        </p>

        <h2 id="testnets">Testnet Deployments</h2>
        <table className="docs-table">
          <thead>
            <tr><th>Contract</th><th>Ethereum Sepolia</th><th>Base Sepolia</th></tr>
          </thead>
          <tbody>
            {contractEntries.map(({ name, key }) => (
              <tr key={name}>
                <td>{name}</td>
                <td><code>{TESTNET_NETWORK_ROWS[0].contracts[key] || "—"}</code></td>
                <td><code>{TESTNET_NETWORK_ROWS[1].contracts[key] || "—"}</code></td>
              </tr>
            ))}
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
          <li className="docs-toc-item active"><a href="#testnets">Testnet Deployments</a></li>
        </ul>
      </nav>
    </div>
  );
}
