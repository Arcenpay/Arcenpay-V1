// ============================================================
//  Provider Dashboard — Overview Page
//  Shows key metrics, recent activity, and contract status
// ============================================================

const CONTRACTS = {
  PlanFactory: '0xc736f5d91aC0039b97A4Fc3540B8f3d59E7FdBa6',
  FeeCollector: '0x513fab5218045790364b33A38D95FE8E17403BAe',
  SubscriptionRegistry: '0xf45A9E5280F72260a713c50b0Ca4e4FB1e22Cc8A',
  SessionVault: '0x2dccEaad8551a620E4Fc736bb4d0fbb8D1A17D7C',
  ZKUsageVerifier: '0x265E0dC80b00044d183AFa83237F5976bB4d585c',
  AutopayModule: '0x3f3734fb45D1511c23384D18Eb1927492E5e3764',
  MirrorRegistry: '0x05BdaB1b4A87a4a5DF3Af1Ebb9Da853A0d31592E',
};

export default function OverviewPage() {
  return (
    <>
      <div className="page-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1>Provider Dashboard</h1>
            <p>MEAP + ZKVUB Protocol — Sepolia Testnet</p>
          </div>
          <div className="network-badge">Sepolia (11155111)</div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="label">Active Plans</div>
          <div className="value">0</div>
          <div className="change up">Ready to create</div>
        </div>
        <div className="stat-card">
          <div className="label">Subscribers</div>
          <div className="value">0</div>
          <div className="change">No subscriptions yet</div>
        </div>
        <div className="stat-card">
          <div className="label">Total Revenue</div>
          <div className="value">$0.00</div>
          <div className="change">USDC on Sepolia</div>
        </div>
        <div className="stat-card">
          <div className="label">ZKVUB Sessions</div>
          <div className="value">0</div>
          <div className="change">Active sessions</div>
        </div>
      </div>

      {/* Deployed Contracts */}
      <div className="data-table">
        <div className="table-header">
          <h3>Deployed Contracts</h3>
          <span className="badge active">7 Live</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Contract</th>
              <th>Address</th>
              <th>Status</th>
              <th>Explorer</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(CONTRACTS).map(([name, address]) => (
              <tr key={name}>
                <td style={{ fontWeight: 600 }}>{name}</td>
                <td className="address">{address}</td>
                <td><span className="badge active">Deployed</span></td>
                <td>
                  <a
                    href={`https://sepolia.etherscan.io/address/${address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View ↗
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
