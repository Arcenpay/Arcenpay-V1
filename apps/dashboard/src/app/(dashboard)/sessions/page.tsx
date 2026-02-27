"use client";

import { useState, useEffect } from "react";
import { useAccount, useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseUnits } from "viem";
import { SessionVaultABI, getContractAddresses, TOKENS } from "@meap/core";
import { CHAIN_ID, formatUSDC, truncateAddress } from "@/lib/contracts";
import { TransactionFlow } from "@/components/TransactionFlow";

const contracts = getContractAddresses(CHAIN_ID);
const USDC = TOKENS[CHAIN_ID as keyof typeof TOKENS]?.USDC as `0x${string}`;

export default function SessionsPage() {
  const { address } = useAccount();
  const [showDeposit, setShowDeposit] = useState(false);
  const [depositAmount, setDepositAmount] = useState("");

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

  // Write: USDC approve for deposit
  const {
    writeContract: writeApprove,
    data: approveHash,
    isPending: isApproving,
    error: approveError,
    reset: resetApprove,
  } = useWriteContract();

  const { isSuccess: approveConfirmed } = useWaitForTransactionReceipt({
    hash: approveHash,
  });

  // Write: Fund session
  const {
    writeContract: writeFund,
    data: fundHash,
    isPending: isFunding,
    error: fundError,
    reset: resetFund,
  } = useWriteContract();

  const { isSuccess: fundConfirmed, isLoading: fundConfirming } = useWaitForTransactionReceipt({
    hash: fundHash,
  });

  // Auto-call fundSession after approve confirms
  useEffect(() => {
    if (approveConfirmed && depositAmount) {
      const amount = parseUnits(depositAmount, 6);
      writeFund({
        address: contracts.sessionVault as `0x${string}`,
        abi: SessionVaultABI,
        functionName: "fundSession",
        args: [amount, USDC],
        chainId: CHAIN_ID,
      });
    }
  }, [approveConfirmed, depositAmount, writeFund]);

  // Refetch after successful fund
  useEffect(() => {
    if (fundConfirmed) {
      refetch();
      setDepositAmount("");
      setShowDeposit(false);
    }
  }, [fundConfirmed, refetch]);

  // Write: Withdraw session
  const {
    writeContract: writeWithdraw,
    data: withdrawHash,
    isPending: isWithdrawing,
    error: withdrawError,
    reset: resetWithdraw,
  } = useWriteContract();

  const { isSuccess: withdrawConfirmed, isLoading: withdrawConfirming } = useWaitForTransactionReceipt({
    hash: withdrawHash,
  });

  useEffect(() => {
    if (withdrawConfirmed) {
      refetch();
    }
  }, [withdrawConfirmed, refetch]);

  const handleDeposit = () => {
    if (!depositAmount || !USDC) return;
    const amount = parseUnits(depositAmount, 6);
    writeApprove({
      address: USDC,
      abi: [{
        type: "function",
        name: "approve",
        inputs: [
          { name: "spender", type: "address" },
          { name: "amount", type: "uint256" },
        ],
        outputs: [{ name: "", type: "bool" }],
        stateMutability: "nonpayable",
      }] as const,
      functionName: "approve",
      args: [contracts.sessionVault as `0x${string}`, amount],
      chainId: CHAIN_ID,
    });
  };

  const handleWithdraw = (sessionId: `0x${string}`) => {
    writeWithdraw({
      address: contracts.sessionVault as `0x${string}`,
      abi: SessionVaultABI,
      functionName: "withdraw",
      args: [sessionId],
      chainId: CHAIN_ID,
    });
  };

  const depositStatus = fundConfirmed
    ? "success"
    : fundConfirming || isFunding
      ? "confirming"
      : isApproving
        ? "pending"
        : (approveError || fundError)
          ? "error"
          : "idle";

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
            <h1>ZKVUB Sessions</h1>
            <p>
              Monitor active billing sessions, vault balances, and proof settlements
            </p>
          </div>
          <button
            className="btn btn-primary"
            onClick={() => setShowDeposit(!showDeposit)}
            disabled={!address}
          >
            + Fund Session
          </button>
        </div>
      </div>

      {!address && (
        <div className="alert alert-warning">
          Connect your wallet to view sessions.
        </div>
      )}

      {/* Deposit Form */}
      {showDeposit && (
        <div className="data-table" style={{ marginBottom: 24 }}>
          <div className="table-header">
            <h3>Fund New Session</h3>
          </div>
          <div
            style={{
              padding: 24,
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 16,
            }}
          >
            <div>
              <label className="form-label">Amount (USDC)</label>
              <input
                type="number"
                placeholder="10.00"
                step="0.01"
                className="form-input"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
              />
            </div>
            <div>
              <label className="form-label">Token</label>
              <input
                type="text"
                className="form-input"
                value="USDC"
                disabled
              />
            </div>
            <div
              style={{
                gridColumn: "1 / -1",
                display: "flex",
                gap: 12,
                justifyContent: "flex-end",
                paddingTop: 8,
              }}
            >
              <button
                className="btn"
                onClick={() => {
                  setShowDeposit(false);
                  resetApprove();
                  resetFund();
                }}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleDeposit}
                disabled={!depositAmount || isApproving || isFunding || fundConfirming}
              >
                {isApproving
                  ? "Approving USDC..."
                  : isFunding || fundConfirming
                    ? "Funding Session..."
                    : "Approve & Fund Session"}
              </button>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <TransactionFlow
                status={depositStatus as any}
                txHash={fundHash || approveHash}
                error={approveError || fundError}
                chainId={CHAIN_ID}
                onReset={() => { resetApprove(); resetFund(); }}
                successMessage="Session funded on-chain!"
              />
            </div>
          </div>
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
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={7} style={{ padding: 24 }}>
                  <div
                    className="skeleton"
                    style={{ width: "100%", height: 20 }}
                  />
                </td>
              </tr>
            ) : sessions.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  style={{
                    textAlign: "center",
                    color: "var(--text-muted)",
                    padding: 40,
                  }}
                >
                  No ZKVUB sessions active. Click "Fund Session" to deposit USDC.
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
                  <td>
                    {session!.active && session!.balance > 0n && (
                      <button
                        className="btn"
                        style={{ fontSize: 12, padding: "4px 8px" }}
                        onClick={() => handleWithdraw(session!.id as `0x${string}`)}
                        disabled={isWithdrawing || withdrawConfirming}
                      >
                        {isWithdrawing || withdrawConfirming ? "..." : "Withdraw"}
                      </button>
                    )}
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

