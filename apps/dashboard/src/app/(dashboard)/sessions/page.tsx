"use client";

import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { SessionVaultABI, getContractAddresses } from "@meap/core";
import { CHAIN_ID, formatUSDC, truncateAddress } from "@/lib/contracts";

const contracts = getContractAddresses(CHAIN_ID);

export default function SessionsPage() {
  const { address } = useAccount();

  // Get session IDs for connected address
  const {
    data: sessionIds,
    isLoading,
    refetch,
  } = useReadContract({
    address: contracts.sessionVault as `0x${string}`,
    abi: SessionVaultABI,
    functionName: "getAgentSessions",
    args: [address!],
    chainId: CHAIN_ID,
    query: { enabled: !!address },
  });

  // Get session details for each ID
  const sessionContracts = ((sessionIds as `0x${string}`[]) || []).map(
    (id) => ({
      address: contracts.sessionVault as `0x${string}`,
      abi: SessionVaultABI,
      functionName: "getSession" as const,
      args: [id] as const,
      chainId: CHAIN_ID,
    }),
  );

  const { data: sessionsData } = useReadContracts({
    contracts: sessionContracts,
    query: { enabled: sessionContracts.length > 0 },
  });

  // Parse session data
  const sessions = ((sessionIds as `0x${string}`[]) || [])
    .map((id, i) => {
      const result = sessionsData?.[i]?.result as any;
      if (!result) return null;
      return {
        id,
        agent: result.agent as string,
        token: result.token as string,
        balance: result.balance as bigint,
        totalFunded: result.totalFunded as bigint,
        totalSettled: result.totalSettled as bigint,
        active: result.active as boolean,
        createdAt: Number(result.createdAt),
      };
    })
    .filter(Boolean);

  const activeSessions = sessions.filter((s) => s!.active);
  const totalFunded = sessions.reduce(
    (sum, s) => sum + (s!.totalFunded ?? BigInt(0)),
    BigInt(0),
  );
  const totalSettled = sessions.reduce(
    (sum, s) => sum + (s!.totalSettled ?? BigInt(0)),
    BigInt(0),
  );

  return (
    <>
      <div className="page-header">
        <h1>ZKVUB Sessions</h1>
        <p>
          Monitor active billing sessions, vault balances, and proof settlements
        </p>
      </div>

      {!address && (
        <div className="alert alert-warning">
          Connect your wallet to view sessions.
        </div>
      )}

      <div className="stats-grid">
        <div className="stat-card">
          <div className="label">Active Sessions</div>
          <div className="value">
            {isLoading ? (
              <div className="skeleton" style={{ width: 40, height: 32 }} />
            ) : (
              activeSessions.length
            )}
          </div>
        </div>
        <div className="stat-card">
          <div className="label">Total Funded</div>
          <div className="value">
            {isLoading ? (
              <div className="skeleton" style={{ width: 80, height: 32 }} />
            ) : (
              `$${formatUSDC(totalFunded)}`
            )}
          </div>
        </div>
        <div className="stat-card">
          <div className="label">Total Settled</div>
          <div className="value">
            {isLoading ? (
              <div className="skeleton" style={{ width: 80, height: 32 }} />
            ) : (
              `$${formatUSDC(totalSettled)}`
            )}
          </div>
        </div>
        <div className="stat-card">
          <div className="label">Proofs Verified</div>
          <div className="value">—</div>
          <div className="change">Requires ZK pipeline</div>
        </div>
      </div>

      <div className="data-table">
        <div className="table-header">
          <h3>Session Activity</h3>
          <button className="btn" onClick={() => refetch()}>
            Refresh
          </button>
        </div>
        <table>
          <thead>
            <tr>
              <th>Session ID</th>
              <th>Agent</th>
              <th>Funded</th>
              <th>Settled</th>
              <th>Balance</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={6} style={{ padding: 24 }}>
                  <div
                    className="skeleton"
                    style={{ width: "100%", height: 20 }}
                  />
                </td>
              </tr>
            ) : sessions.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  style={{
                    textAlign: "center",
                    color: "var(--text-muted)",
                    padding: 40,
                  }}
                >
                  No ZKVUB sessions active. Deploy x402 middleware to start
                  metering.
                </td>
              </tr>
            ) : (
              sessions.map((session) => (
                <tr key={session!.id}>
                  <td className="address" title={session!.id}>
                    {truncateAddress(session!.id)}
                  </td>
                  <td className="address" title={session!.agent}>
                    {truncateAddress(session!.agent)}
                  </td>
                  <td>${formatUSDC(session!.totalFunded)}</td>
                  <td>${formatUSDC(session!.totalSettled)}</td>
                  <td>${formatUSDC(session!.balance)}</td>
                  <td>
                    <span
                      className={`badge ${session!.active ? "active" : "inactive"}`}
                    >
                      {session!.active ? "Active" : "Closed"}
                    </span>
                  </td>
                </tr>
              ))
            )}
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
              <td
                colSpan={6}
                style={{
                  textAlign: "center",
                  color: "var(--text-muted)",
                  padding: 40,
                }}
              >
                No settlements yet. Proofs will appear after zk-SNARK
                verification.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
