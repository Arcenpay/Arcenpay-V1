"use client";

import { useState, useEffect } from "react";
import {
  useAccount,
  usePublicClient,
  useReadContracts,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import {
  SubscriptionRegistryABI,
  PlanFactoryABI,
  getContractAddresses,
} from "@meap/core";
import { CHAIN_ID, truncateAddress, getExplorerUrl } from "@/lib/contracts";
import { TransactionFlow } from "@/components/TransactionFlow";

const contracts = getContractAddresses(CHAIN_ID);

interface Subscriber {
  address: string;
  tokenId: bigint;
  planId: bigint;
  expiration: bigint;
}

export default function SubscribersPage() {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: CHAIN_ID });
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedActionToken, setSelectedActionToken] = useState<bigint | null>(
    null,
  );

  // Fetch SubscriptionMinted events
  useEffect(() => {
    async function fetchSubscribers() {
      if (!publicClient) {
        setLoading(false);
        return;
      }
      try {
        const logs = await publicClient.getLogs({
          address: contracts.subscriptionRegistry as `0x${string}`,
          event: {
            type: "event",
            name: "SubscriptionMinted",
            inputs: [
              { name: "subscriber", type: "address", indexed: true },
              { name: "tokenId", type: "uint256", indexed: true },
              { name: "planId", type: "uint256", indexed: true },
              { name: "expiration", type: "uint64", indexed: false },
            ],
          },
          fromBlock: BigInt(0),
          toBlock: "latest",
        });

        const subs: Subscriber[] = logs.map((log) => ({
          address: log.args.subscriber as string,
          tokenId: log.args.tokenId as bigint,
          planId: log.args.planId as bigint,
          expiration: log.args.expiration as bigint,
        }));
        setSubscribers(subs);
      } catch {
        // Event query may fail on some RPCs
      } finally {
        setLoading(false);
      }
    }
    fetchSubscribers();
  }, [publicClient]);

  // Batch check validity for each subscriber
  const validityContracts = subscribers.map((sub) => ({
    address: contracts.subscriptionRegistry as `0x${string}`,
    abi: SubscriptionRegistryABI,
    functionName: "isValid" as const,
    args: [sub.tokenId] as const,
    chainId: CHAIN_ID,
  }));

  const { data: validityData } = useReadContracts({
    contracts: validityContracts,
    query: { enabled: validityContracts.length > 0 },
  });

  const activeCount =
    validityData?.filter((v) => v.result === true).length ?? 0;

  const uniquePlanIds = Array.from(
    new Set(subscribers.map((s) => s.planId.toString())),
  ).map((id) => BigInt(id));

  const { data: planData } = useReadContracts({
    contracts: uniquePlanIds.map((id) => ({
      address: contracts.planFactory as `0x${string}`,
      abi: PlanFactoryABI,
      functionName: "getPlan" as const,
      args: [id] as const,
      chainId: CHAIN_ID,
    })),
    query: { enabled: uniquePlanIds.length > 0 },
  });

  const planIntervals = new Map<string, number>();
  uniquePlanIds.forEach((id, idx) => {
    const plan = planData?.[idx]?.result as
      | { billingInterval: number | bigint }
      | undefined;
    if (plan) {
      planIntervals.set(id.toString(), Number(plan.billingInterval));
    }
  });

  const {
    writeContract: writeAction,
    data: actionTxHash,
    isPending: actionPending,
    error: actionError,
    reset: resetAction,
  } = useWriteContract();

  const { isLoading: actionConfirming, isSuccess: actionSuccess } =
    useWaitForTransactionReceipt({
      hash: actionTxHash,
    });

  useEffect(() => {
    if (!actionSuccess) return;
    setSelectedActionToken(null);
    resetAction();
    if (!publicClient) return;
    (async () => {
      try {
        const logs = await publicClient.getLogs({
          address: contracts.subscriptionRegistry as `0x${string}`,
          event: {
            type: "event",
            name: "SubscriptionMinted",
            inputs: [
              { name: "subscriber", type: "address", indexed: true },
              { name: "tokenId", type: "uint256", indexed: true },
              { name: "planId", type: "uint256", indexed: true },
              { name: "expiration", type: "uint64", indexed: false },
            ],
          },
          fromBlock: BigInt(0),
          toBlock: "latest",
        });

        const subs: Subscriber[] = logs.map((log) => ({
          address: log.args.subscriber as string,
          tokenId: log.args.tokenId as bigint,
          planId: log.args.planId as bigint,
          expiration: log.args.expiration as bigint,
        }));
        setSubscribers(subs);
      } catch {
        // no-op
      }
    })();
  }, [actionSuccess, resetAction, publicClient]);

  const handleRenew = (sub: Subscriber) => {
    const extension = planIntervals.get(sub.planId.toString()) ?? 2_592_000;
    setSelectedActionToken(sub.tokenId);
    writeAction({
      address: contracts.subscriptionRegistry as `0x${string}`,
      abi: SubscriptionRegistryABI,
      functionName: "renew",
      args: [sub.tokenId, BigInt(extension)],
      chainId: CHAIN_ID,
    });
  };

  const handleCancel = (sub: Subscriber) => {
    setSelectedActionToken(sub.tokenId);
    writeAction({
      address: contracts.subscriptionRegistry as `0x${string}`,
      abi: SubscriptionRegistryABI,
      functionName: "cancel",
      args: [sub.tokenId],
      chainId: CHAIN_ID,
    });
  };

  return (
    <>
      <div className="page-header">
        <h1>Subscribers</h1>
        <p>View and manage active subscribers from SubscriptionRegistry</p>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="label">Total Subscribers</div>
          <div className="value">
            {loading ? (
              <div className="skeleton" style={{ width: 40, height: 32 }} />
            ) : (
              subscribers.length
            )}
          </div>
        </div>
        <div className="stat-card">
          <div className="label">Active NFTs</div>
          <div className="value">
            {loading ? (
              <div className="skeleton" style={{ width: 40, height: 32 }} />
            ) : (
              activeCount
            )}
          </div>
        </div>
        <div className="stat-card">
          <div className="label">Renewal Rate</div>
          <div className="value">—</div>
          <div className="change">Requires indexer</div>
        </div>
        <div className="stat-card">
          <div className="label">Churn Rate</div>
          <div className="value">—</div>
          <div className="change">Requires indexer</div>
        </div>
      </div>

      <div className="data-table">
        <div className="table-header">
          <h3>Active Subscriptions</h3>
          <span style={{ color: "var(--text-secondary)", fontSize: 13 }}>
            {subscribers.length} found on-chain
          </span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Wallet</th>
              <th>Token ID</th>
              <th>Plan ID</th>
              <th>Expires</th>
              <th>Status</th>
              <th>Explorer</th>
              <th>Manage</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} style={{ padding: 24 }}>
                  <div
                    className="skeleton"
                    style={{ width: "100%", height: 20 }}
                  />
                </td>
              </tr>
            ) : subscribers.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  style={{
                    textAlign: "center",
                    color: "var(--text-muted)",
                    padding: 40,
                  }}
                >
                  No subscribers yet. Share your PricingTable to get started.
                </td>
              </tr>
            ) : (
              subscribers.map((sub, i) => {
                const isValid = validityData?.[i]?.result === true;
                const expiryDate = new Date(Number(sub.expiration) * 1000);
                const isExpired = expiryDate < new Date();
                return (
                  <tr key={`${sub.tokenId}`}>
                    <td className="address" title={sub.address}>
                      {truncateAddress(sub.address)}
                    </td>
                    <td>#{sub.tokenId.toString()}</td>
                    <td>#{sub.planId.toString()}</td>
                    <td title={expiryDate.toISOString()}>
                      {expiryDate.toLocaleDateString()}
                    </td>
                    <td>
                      <span
                        className={`badge ${isValid ? "active" : "inactive"}`}
                      >
                        {isValid
                          ? "Active"
                          : isExpired
                            ? "Expired"
                            : "Inactive"}
                      </span>
                    </td>
                    <td>
                      <a
                        href={getExplorerUrl(sub.address, CHAIN_ID, "address")}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        View ↗
                      </a>
                    </td>
                    <td>
                      {address &&
                        address.toLowerCase() === sub.address.toLowerCase() && (
                          <div style={{ display: "flex", gap: 8 }}>
                            <button
                              className="btn"
                              style={{ fontSize: 11, padding: "4px 8px" }}
                              onClick={() => handleRenew(sub)}
                              disabled={
                                actionPending ||
                                actionConfirming ||
                                selectedActionToken === sub.tokenId
                              }
                            >
                              Renew
                            </button>
                            <button
                              className="btn"
                              style={{
                                fontSize: 11,
                                padding: "4px 8px",
                                borderColor: "var(--danger)",
                                color: "var(--danger)",
                              }}
                              onClick={() => handleCancel(sub)}
                              disabled={
                                actionPending ||
                                actionConfirming ||
                                selectedActionToken === sub.tokenId
                              }
                            >
                              Cancel
                            </button>
                          </div>
                        )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        <div style={{ padding: 16 }}>
          <TransactionFlow
            status={
              actionSuccess
                ? "success"
                : actionConfirming
                  ? "confirming"
                  : actionPending
                    ? "pending"
                    : actionError
                      ? "error"
                      : "idle"
            }
            txHash={actionTxHash}
            error={actionError}
            chainId={CHAIN_ID}
            onReset={resetAction}
            successMessage="Subscription action confirmed on-chain."
          />
        </div>
      </div>
    </>
  );
}
