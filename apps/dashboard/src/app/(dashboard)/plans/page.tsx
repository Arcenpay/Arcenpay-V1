"use client";

import { useState, useEffect } from "react";
import {
  useAccount,
  useReadContract,
  useReadContracts,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { parseUnits } from "viem";
import { PlanFactoryABI, getContractAddresses, TOKENS } from "@meap/core";
import { CHAIN_ID, formatUSDC, formatInterval } from "@/lib/contracts";
import { TransactionFlow } from "@/components/TransactionFlow";

const contracts = getContractAddresses(CHAIN_ID);
const USDC = TOKENS[CHAIN_ID as keyof typeof TOKENS]?.USDC as `0x${string}`;

export default function PlansPage() {
  const { address } = useAccount();
  const [showCreate, setShowCreate] = useState(false);
  const [planName, setPlanName] = useState("");
  const [planTier, setPlanTier] = useState("starter");
  const [planPrice, setPlanPrice] = useState("");
  const [planInterval, setPlanInterval] = useState("2592000");

  // Check if provider is registered
  const { data: isProvider } = useReadContract({
    address: contracts.planFactory as `0x${string}`,
    abi: PlanFactoryABI,
    functionName: "isProvider",
    args: [address!],
    chainId: CHAIN_ID,
    query: { enabled: !!address },
  });

  // Get provider's plan IDs
  const { data: planIds, refetch: refetchPlans } = useReadContract({
    address: contracts.planFactory as `0x${string}`,
    abi: PlanFactoryABI,
    functionName: "getProviderPlans",
    args: [address!],
    chainId: CHAIN_ID,
    query: { enabled: !!address },
  });

  // Get plan details for each ID
  const planContracts = ((planIds as bigint[]) || []).map((id) => ({
    address: contracts.planFactory as `0x${string}`,
    abi: PlanFactoryABI,
    functionName: "getPlan" as const,
    args: [id] as const,
    chainId: CHAIN_ID,
  }));

  const { data: plansData, isLoading: plansLoading } = useReadContracts({
    contracts: planContracts,
    query: { enabled: planContracts.length > 0 },
  });

  // Write: createPlan
  const {
    writeContract,
    data: txHash,
    isPending,
    error: writeError,
    reset,
  } = useWriteContract();

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  // Refetch plans on successful creation
  useEffect(() => {
    if (isSuccess) {
      refetchPlans();
      setPlanName("");
      setPlanPrice("");
      setPlanTier("starter");
      setPlanInterval("2592000");
    }
  }, [isSuccess, refetchPlans]);

  const handleCreatePlan = () => {
    if (!planName || !planPrice) return;
    const priceAtomic = parseUnits(planPrice, 6);
    writeContract({
      address: contracts.planFactory as `0x${string}`,
      abi: PlanFactoryABI,
      functionName: "createPlan",
      args: [planName, planTier, priceAtomic, Number(planInterval), USDC, ""],
      chainId: CHAIN_ID,
    });
  };

  const txStatus = isSuccess
    ? "success"
    : isConfirming
      ? "confirming"
      : isPending
        ? "pending"
        : writeError
          ? "error"
          : "idle";

  // Parse plan data from contract results
  const plans = (plansData || [])
    .map((result) => {
      const plan = result.result as any;
      if (!plan) return null;
      return {
        id: Number(plan.id),
        name: plan.name as string,
        tier: plan.tier as string,
        price: plan.price as bigint,
        billingInterval: Number(plan.billingInterval),
        active: plan.active as boolean,
      };
    })
    .filter(Boolean);

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
            <h1>Plans</h1>
            <p>Create and manage subscription plans via PlanFactory</p>
          </div>
          <button
            className="btn btn-primary"
            onClick={() => setShowCreate(!showCreate)}
            disabled={!address || isProvider === false}
          >
            + Create Plan
          </button>
        </div>
      </div>

      {!address && (
        <div className="alert alert-warning">
          Connect your wallet to manage plans.
        </div>
      )}

      {address && isProvider === false && (
        <div className="alert alert-warning">
          Your wallet is not registered as a provider. Contact the protocol
          admin to register your address.
        </div>
      )}

      {showCreate && (
        <div className="data-table" style={{ marginBottom: 24 }}>
          <div className="table-header">
            <h3>New Plan</h3>
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
              <label className="form-label">Plan Name</label>
              <input
                type="text"
                placeholder="e.g., Professional"
                className="form-input"
                value={planName}
                onChange={(e) => setPlanName(e.target.value)}
              />
            </div>
            <div>
              <label className="form-label">Tier</label>
              <select
                className="form-input"
                value={planTier}
                onChange={(e) => setPlanTier(e.target.value)}
              >
                <option value="starter">Starter</option>
                <option value="pro">Professional</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </div>
            <div>
              <label className="form-label">Price (USDC)</label>
              <input
                type="number"
                placeholder="29.99"
                step="0.01"
                className="form-input"
                value={planPrice}
                onChange={(e) => setPlanPrice(e.target.value)}
              />
            </div>
            <div>
              <label className="form-label">Billing Interval</label>
              <select
                className="form-input"
                value={planInterval}
                onChange={(e) => setPlanInterval(e.target.value)}
              >
                <option value="2592000">Monthly (30 days)</option>
                <option value="7776000">Quarterly (90 days)</option>
                <option value="31536000">Annually (365 days)</option>
              </select>
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
                  setShowCreate(false);
                  reset();
                }}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleCreatePlan}
                disabled={!planName || !planPrice || isPending || isConfirming}
              >
                {isPending || isConfirming
                  ? "Deploying..."
                  : "Deploy Plan to Chain"}
              </button>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <TransactionFlow
                status={txStatus as any}
                txHash={txHash}
                error={writeError}
                chainId={CHAIN_ID}
                onReset={reset}
                successMessage="Plan deployed on-chain!"
              />
            </div>
          </div>
        </div>
      )}

      <div className="data-table">
        <div className="table-header">
          <h3>All Plans</h3>
          <span style={{ color: "var(--text-secondary)", fontSize: 13 }}>
            {plans.length} plan{plans.length !== 1 ? "s" : ""} on-chain
          </span>
        </div>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Plan</th>
              <th>Tier</th>
              <th>Price</th>
              <th>Interval</th>
              <th>Status</th>
              <th>Manage</th>
            </tr>
          </thead>
          <tbody>
            {plansLoading ? (
              <tr>
                <td colSpan={7} style={{ padding: 24 }}>
                  <div
                    className="skeleton"
                    style={{ width: "100%", height: 20 }}
                  />
                </td>
              </tr>
            ) : plans.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  style={{
                    textAlign: "center",
                    color: "var(--text-muted)",
                    padding: 40,
                  }}
                >
                  No plans created yet. Click "Create Plan" to deploy your first
                  plan.
                </td>
              </tr>
            ) : (
              plans.map((plan) => (
                <tr key={plan!.id}>
                  <td style={{ color: "var(--text-muted)" }}>#{plan!.id}</td>
                  <td style={{ fontWeight: 600 }}>{plan!.name}</td>
                  <td>
                    <span className={`badge ${plan!.tier}`}>{plan!.tier}</span>
                  </td>
                  <td>${formatUSDC(plan!.price)} USDC</td>
                  <td>{formatInterval(plan!.billingInterval)}</td>
                  <td>
                    <span
                      className={`badge ${plan!.active ? "active" : "inactive"}`}
                    >
                      {plan!.active ? "Active" : "Inactive"}
                    </span
                    >
                  </td>
                  <td>
                    {plan!.active && (
                      <button
                        className="btn"
                        style={{
                          fontSize: 11,
                          padding: "4px 10px",
                          borderColor: "var(--danger)",
                          color: "var(--danger)",
                        }}
                        onClick={() => {
                          writeContract({
                            address: contracts.planFactory as `0x${string}`,
                            abi: PlanFactoryABI,
                            functionName: "deactivatePlan",
                            args: [BigInt(plan!.id)],
                            chainId: CHAIN_ID,
                          });
                        }}
                        disabled={isPending || isConfirming}
                      >
                        Deactivate
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
