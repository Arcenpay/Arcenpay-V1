// ============================================================
//  Provider Dashboard — ZKVUB Sessions Page
//  Monitor active billing sessions, balances, and settlements
// ============================================================

export default function SessionsPage() {
  return (
    <>
      <div className="page-header">
        <h1>ZKVUB Sessions</h1>
        <p>Monitor active billing sessions, vault balances, and proof settlements</p>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="label">Active Sessions</div>
          <div className="value">0</div>
        </div>
        <div className="stat-card">
          <div className="label">Total Funded</div>
          <div className="value">$0.00</div>
        </div>
        <div className="stat-card">
          <div className="label">Total Settled</div>
          <div className="value">$0.00</div>
        </div>
        <div className="stat-card">
          <div className="label">Proofs Verified</div>
          <div className="value">0</div>
        </div>
      </div>

      <div className="data-table">
        <div className="table-header">
          <h3>Session Activity</h3>
          <button className="btn">Refresh</button>
        </div>
        <table>
          <thead>
            <tr>
              <th>Session ID</th>
              <th>Agent</th>
              <th>Funded</th>
              <th>Used</th>
              <th>Balance</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>
                No ZKVUB sessions active. Deploy x402 middleware to start metering.
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="data-table" style={{ marginTop: 24 }}>
        <div className="table-header">
          <h3>Recent Settlements</h3>
        </div>
        <table>
          <thead>
            <tr>
              <th>Proof Hash</th>
              <th>Session</th>
              <th>Calls</th>
              <th>Amount</th>
              <th>Gas Used</th>
              <th>Timestamp</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>
                No settlements yet. Proofs will appear after zk-SNARK verification.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
