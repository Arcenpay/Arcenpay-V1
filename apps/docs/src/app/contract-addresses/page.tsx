import { getContractAddresses, getPrimaryRuntimeChainProfile } from "@arcenpay/sdk";

export default function ContractAddressesPage() {
  const runtime = getPrimaryRuntimeChainProfile();
  const contracts = getContractAddresses(runtime.chainId);

  const contractEntries = [
    { name: "PlanFactory", value: contracts.planFactory },
    { name: "SubscriptionRegistry", value: contracts.subscriptionRegistry },
    { name: "ERC7579AutopayModule", value: contracts.autopayModule },
    { name: "FeeCollector", value: contracts.feeCollector },
    { name: "SessionVault", value: contracts.sessionVault },
    { name: "ZKUsageVerifier", value: contracts.zkUsageVerifier },
    { name: "MirrorRegistry", value: contracts.mirrorRegistry ?? "—" },
  ];

  return (
    <div className="docs-body" style={{ width: "100%" }}>
      <article className="docs-article">
        <div className="docs-page-breadcrumb">Developers</div>
        <div className="docs-page-title-row">
          <h1>Contract Addresses</h1>
        </div>

        <p className="docs-lead">
          The primary runtime chain is <strong>{runtime.chainName}</strong> (
          {runtime.chainId}). Use these addresses for the current product path.
          Sepolia should be treated as legacy/internal reference, not the main
          deployment target for new integrations.
        </p>

        <table className="docs-table">
          <thead>
            <tr><th>Contract</th><th>{runtime.chainName}</th></tr>
          </thead>
          <tbody>
            {contractEntries.map((entry) => (
              <tr key={entry.name}>
                <td>{entry.name}</td>
                <td><code>{entry.value || "—"}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      </article>

      <nav className="docs-toc" aria-label="Table of contents">
        <div className="docs-toc-heading">On this page</div>
        <ul className="docs-toc-list">
          <li className="docs-toc-item active"><a href="#top">Runtime contracts</a></li>
        </ul>
      </nav>
    </div>
  );
}
