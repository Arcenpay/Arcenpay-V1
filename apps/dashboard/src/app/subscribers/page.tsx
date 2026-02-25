// ============================================================
//  Provider Dashboard — Subscribers Page
//  PRD MEAP-009: View subscriber metrics and manage subscriptions
// ============================================================

export default function SubscribersPage() {
  return (
    <>
      <div className="page-header">
        <h1>Subscribers</h1>
        <p>View and manage active subscribers from SubscriptionRegistry</p>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="label">Total Subscribers</div>
          <div className="value">0</div>
        </div>
        <div className="stat-card">
          <div className="label">Active NFTs</div>
          <div className="value">0</div>
        </div>
        <div className="stat-card">
          <div className="label">Renewal Rate</div>
          <div className="value">—</div>
        </div>
        <div className="stat-card">
          <div className="label">Churn Rate</div>
          <div className="value">—</div>
        </div>
      </div>

      <div className="data-table">
        <div className="table-header">
          <h3>Active Subscriptions</h3>
          <button className="btn">Export CSV</button>
        </div>
        <table>
          <thead>
            <tr>
              <th>Wallet</th>
              <th>Token ID</th>
              <th>Plan</th>
              <th>Expires</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>
                No subscribers yet. Share your PricingTable to get started.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
