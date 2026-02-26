"use client";

import { useAccount, useReadContracts } from "wagmi";
import {
  PlanFactoryABI,
  FeeCollectorABI,
  SessionVaultABI,
  getContractAddresses,
} from "@meap/core";
import {
  CHAIN_ID,
  USDC_ADDRESS,
  formatUSDC,
  getExplorerUrl,
  truncateAddress,
} from "@/lib/contracts";

const contracts = getContractAddresses(CHAIN_ID);

const DEPLOYED_CONTRACTS: Record<string, string> = {
  PlanFactory: contracts.planFactory,
  FeeCollector: contracts.feeCollector,
  SubscriptionRegistry: contracts.subscriptionRegistry,
  SessionVault: contracts.sessionVault,
  ZKUsageVerifier: contracts.zkUsageVerifier,
  AutopayModule: contracts.autopayModule,
  ...(contracts.mirrorRegistry
    ? { MirrorRegistry: contracts.mirrorRegistry }
    : {}),
};

export default function OverviewPage() {
  const { address } = useAccount();

  const { data, isLoading } = useReadContracts({
    contracts: [
      {
        address: contracts.planFactory as `0x${string}`,
        abi: PlanFactoryABI,
        functionName: "getProviderPlans",
        args: [address!],
        chainId: CHAIN_ID,
      },
      {
        address: contracts.feeCollector as `0x${string}`,
        abi: FeeCollectorABI,
        functionName: "accumulatedFees",
        args: [USDC_ADDRESS],
        chainId: CHAIN_ID,
      },
      {
        address: contracts.sessionVault as `0x${string}`,
        abi: SessionVaultABI,
        functionName: "getAgentBalance",
        args: [address!],
        chainId: CHAIN_ID,
      },
    ],
    query: { enabled: !!address },
  });

  const planIds = data?.[0]?.result as bigint[] | undefined;
  const totalFees = data?.[1]?.result as bigint | undefined;
  const sessionBalance = data?.[2]?.result as bigint | undefined;

  return (
    <>
      <div className="page-header">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <h1>Provider Dashboard</h1>
            <p>MEAP + ZKVUB Protocol — Sepolia Testnet</p>
          </div>
          <div className="network-badge">Sepolia ({CHAIN_ID})</div>
        </div>
      </div>

      {!address && (
        <div className="alert alert-warning">
          Connect your wallet to view on-chain data.
        </div>
      )}

      <div className="stats-grid">
        <div className="stat-card">
          <div className="label">Active Plans</div>
          <div className="value">
            {isLoading ? (
              <div className="skeleton" style={{ width: 40, height: 32 }} />
            ) : (
              (planIds?.length ?? 0)
            )}
          </div>
          <div className="change up">On-chain via PlanFactory</div>
        </div>
        <div className="stat-card">
          <div className="label">Subscribers</div>
          <div className="value">—</div>
          <div className="change">Indexer required</div>
        </div>
        <div className="stat-card">
          <div className="label">Protocol Fees</div>
          <div className="value">
            {isLoading ? (
              <div className="skeleton" style={{ width: 80, height: 32 }} />
            ) : (
              `$${formatUSDC(totalFees ?? BigInt(0))}`
            )}
          </div>
          <div className="change">USDC accumulated</div>
        </div>
        <div className="stat-card">
          <div className="label">Session Balance</div>
          <div className="value">
            {isLoading ? (
              <div className="skeleton" style={{ width: 80, height: 32 }} />
            ) : (
              `$${formatUSDC(sessionBalance ?? BigInt(0))}`
            )}
          </div>
          <div className="change">ZKVUB vault</div>
        </div>
      </div>

      <div className="data-table">
        <div className="table-header">
          <h3>Deployed Contracts</h3>
          <span className="badge active">
            {Object.keys(DEPLOYED_CONTRACTS).length} Live
          </span>
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
            {Object.entries(DEPLOYED_CONTRACTS).map(([name, addr]) => (
              <tr key={name}>
                <td style={{ fontWeight: 600 }}>{name}</td>
                <td className="address" title={addr}>
                  {truncateAddress(addr)}
                </td>
                <td>
                  <span className="badge active">Deployed</span>
                </td>
                <td>
                  <a
                    href={getExplorerUrl(addr, CHAIN_ID, "address")}
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
