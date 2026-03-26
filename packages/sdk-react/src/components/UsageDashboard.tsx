'use client';

import React from 'react';
import { useAccount, useReadContract, useReadContracts } from 'wagmi';
import { SessionVaultABI, ZKUsageVerifierABI, getContractAddresses } from '@arcenpay/sdk';
import { useMEAP } from '../providers/MEAPProvider';

// ============================================================
//  UsageDashboard — ZKVUB Session Usage Metrics
//  Reads real data from SessionVault + ZKUsageVerifier contracts
// ============================================================

export interface UsageDashboardProps {
  /** ZKVUB session ID (bytes32 hex string) */
  sessionId?: string;
  /** Plan ID for rate schedule lookup */
  planId?: string;
  /** Facilitator Node API base URL (fallback for off-chain metrics) */
  facilitatorUrl?: string;
  /** Polling interval in ms (default: 5000) */
  pollInterval?: number;
  /** Custom CSS class */
  className?: string;
}

export function UsageDashboard({
  sessionId,
  planId,
  facilitatorUrl,
  pollInterval = 5000,
  className = '',
}: UsageDashboardProps) {
  const { network } = useMEAP();
  const { address } = useAccount();
  const contracts = getContractAddresses(network.chainId);

  const vaultAddress = contracts.sessionVault as `0x${string}`;
  const verifierAddress = contracts.zkUsageVerifier as `0x${string}`;

  // Read agent's total balance across all sessions
  const { data: agentBalance, isLoading: balanceLoading } = useReadContract({
    address: vaultAddress,
    abi: SessionVaultABI,
    functionName: 'getAgentBalance',
    args: [address!],
    chainId: network.chainId,
    query: {
      enabled: !!address,
      refetchInterval: pollInterval,
    },
  });

  // If sessionId provided, get specific session details
  const { data: sessionData, isLoading: sessionLoading } = useReadContract({
    address: vaultAddress,
    abi: SessionVaultABI,
    functionName: 'getSession',
    args: [sessionId as `0x${string}`],
    chainId: network.chainId,
    query: {
      enabled: !!sessionId,
      refetchInterval: pollInterval,
    },
  });

  // Get rate schedule from ZKUsageVerifier
  const { data: ratePerCall } = useReadContract({
    address: verifierAddress,
    abi: ZKUsageVerifierABI,
    functionName: 'getRateSchedule',
    args: [planId ? BigInt(planId) : 0n],
    chainId: network.chainId,
    query: { enabled: !!planId },
  });

  // Get pending balance from verifier
  const { data: pendingBalance } = useReadContract({
    address: verifierAddress,
    abi: ZKUsageVerifierABI,
    functionName: 'getPendingBalance',
    args: [address!],
    chainId: network.chainId,
    query: { enabled: !!address },
  });

  const session = sessionData as any;
  const loading = balanceLoading || sessionLoading;

  const formatUSDC = (val: bigint | undefined) => {
    if (val === undefined) return '0.00';
    return (Number(val) / 1e6).toFixed(2);
  };

  const totalBalance = agentBalance as bigint | undefined;
  const rate = ratePerCall as bigint | undefined;
  const pending = pendingBalance as bigint | undefined;

  // Estimate remaining calls
  const estimatedCalls = totalBalance && rate && rate > 0n
    ? Number(totalBalance / rate)
    : 0;

  const statusColors: Record<string, string> = {
    active: '#22c55e',
    settled: '#3b82f6',
    withdrawn: '#a855f7',
    expired: '#ef4444',
  };

  const sessionStatus = session?.active ? 'active' : session ? 'settled' : 'active';

  if (loading) {
    return (
      <div className={`arcenpay-usage-dashboard arcenpay-loading ${className}`}>
        <div className="arcenpay-spinner" />
        <p>Loading session metrics from chain...</p>
      </div>
    );
  }

  return (
    <div className={`arcenpay-usage-dashboard ${className}`}>
      <div className="arcenpay-usage-header">
        <h3>ZKVUB Session Usage</h3>
        <span
          className="arcenpay-status-badge"
          style={{ backgroundColor: statusColors[sessionStatus] || '#6b7280' }}
        >
          {sessionStatus}
        </span>
      </div>

      <div className="arcenpay-usage-grid">
        <div className="arcenpay-metric-card">
          <span className="arcenpay-metric-label">Total Balance</span>
          <span className="arcenpay-metric-value">${formatUSDC(totalBalance)} USDC</span>
        </div>

        {session && (
          <>
            <div className="arcenpay-metric-card">
              <span className="arcenpay-metric-label">Session Balance</span>
              <span className="arcenpay-metric-value">${formatUSDC(session.balance)} USDC</span>
            </div>

            <div className="arcenpay-metric-card">
              <span className="arcenpay-metric-label">Total Funded</span>
              <span className="arcenpay-metric-value">${formatUSDC(session.totalFunded)} USDC</span>
            </div>

            <div className="arcenpay-metric-card">
              <span className="arcenpay-metric-label">Total Settled</span>
              <span className="arcenpay-metric-value">${formatUSDC(session.totalSettled)} USDC</span>
            </div>
          </>
        )}

        <div className="arcenpay-metric-card">
          <span className="arcenpay-metric-label">Rate/Call</span>
          <span className="arcenpay-metric-value">
            {rate ? `$${formatUSDC(rate)}` : '—'} USDC
          </span>
        </div>

        <div className="arcenpay-metric-card">
          <span className="arcenpay-metric-label">Est. Calls Remaining</span>
          <span className="arcenpay-metric-value">
            ~{estimatedCalls.toLocaleString()}
          </span>
        </div>

        <div className="arcenpay-metric-card">
          <span className="arcenpay-metric-label">Pending Settlement</span>
          <span className="arcenpay-metric-value">${formatUSDC(pending)} USDC</span>
        </div>
      </div>

      <div className="arcenpay-usage-footer">
        {sessionId && (
          <span className="arcenpay-session-id">Session: {sessionId.slice(0, 10)}...</span>
        )}
        <span className="arcenpay-last-updated">
          Chain: {network.name} ({network.chainId})
        </span>
      </div>
    </div>
  );
}
