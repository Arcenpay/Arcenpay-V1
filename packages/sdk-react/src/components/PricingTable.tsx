"use client";

import React, { useState, useCallback } from "react";
import { useReadContract, useReadContracts } from "wagmi";
import type { Plan } from "@arcenpay/sdk";
import { PlanFactoryABI, getContractAddresses } from "@arcenpay/sdk";
import { useMEAP } from "../providers/MEAPProvider";

// ============================================================
//  PricingTable — Displays subscription plan tiers
//  Fetches real plan data from PlanFactory contract
//  Stablecoin (USDC) payments only — all chains supported
// ============================================================

interface PricingTableProps {
  /** Plan IDs to display, or provider address to fetch all plans */
  planIds?: bigint[];
  /** Provider address — if provided, fetches all plans for this provider */
  providerAddress?: string;
  onSelectPlan?: (planId: bigint) => void;
  theme?: "light" | "dark";
  className?: string;
}

/**
 * PricingTable — Fetches plan data from PlanFactory and renders pricing tiers
 *
 * @example
 * ```tsx
 * <PricingTable
 *   providerAddress="0x1234..."
 *   onSelectPlan={(planId) => console.log('Selected:', planId)}
 * />
 * ```
 */
export function PricingTable({
  planIds: explicitPlanIds,
  providerAddress,
  onSelectPlan,
  theme = "dark",
  className = "",
}: PricingTableProps) {
  const { network } = useMEAP();
  const contracts = getContractAddresses(network.chainId);
  const factoryAddress = contracts.planFactory as `0x${string}`;

  const [selectedPlan, setSelectedPlan] = useState<bigint | null>(null);

  // Fetch provider's plan IDs if providerAddress given (and no explicit IDs)
  const { data: fetchedPlanIds } = useReadContract({
    address: factoryAddress,
    abi: PlanFactoryABI,
    functionName: "getProviderPlans",
    args: [providerAddress as `0x${string}`],
    chainId: network.chainId,
    query: { enabled: !!providerAddress && !explicitPlanIds },
  });

  const activePlanIds = explicitPlanIds || (fetchedPlanIds as bigint[]) || [];

  // Batch-fetch plan details for each plan ID
  const planContracts = activePlanIds.map((id) => ({
    address: factoryAddress,
    abi: PlanFactoryABI,
    functionName: "getPlan" as const,
    args: [id] as const,
    chainId: network.chainId,
  }));

  const { data: plansData, isLoading } = useReadContracts({
    contracts: planContracts,
    query: { enabled: planContracts.length > 0 },
  });

  // Parse plan data from contract results
  const plans: Plan[] = (plansData || [])
    .map((result) => {
      const plan = result.result as any;
      if (!plan) return null;
      return {
        id: plan.id as bigint,
        provider: plan.provider as string,
        name: plan.name as string,
        tier: plan.tier as string,
        price: plan.price as bigint,
        billingInterval: Number(plan.billingInterval),
        acceptedToken: plan.acceptedToken as string,
        active: plan.active as boolean,
        metadataURI: plan.metadataURI as string,
      };
    })
    .filter((p): p is Plan => p !== null && p.active);

  const handleSelect = useCallback(
    (planId: bigint) => {
      setSelectedPlan(planId);
      onSelectPlan?.(planId);
    },
    [onSelectPlan],
  );

  const formatPrice = (price: bigint) => {
    const dollars = Number(price) / 1_000_000;
    return `$${dollars.toFixed(2)}`;
  };

  const formatInterval = (seconds: number) => {
    if (seconds >= 31_536_000) return "/yr";
    if (seconds >= 7_776_000) return "/qtr";
    if (seconds >= 2_592_000) return "/mo";
    return `/${Math.floor(seconds / 86400)}d`;
  };

  if (isLoading) {
    return (
      <div className={`arcenpay-pricing-loading ${className}`}>
        <div className="arcenpay-spinner" />
        <p>Fetching plans from chain…</p>
      </div>
    );
  }

  if (plans.length === 0) {
    return (
      <div className={`arcenpay-pricing-empty ${className}`}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>◎</div>
        <p style={{ fontWeight: 600, marginBottom: 4 }}>No active plans</p>
        <p style={{ fontSize: 12 }}>
          No subscription plans found on {network.name}.
        </p>
      </div>
    );
  }

  return (
    <div
      className={`arcenpay-pricing-table ${theme} ${className}`}
      data-arcenpay-component="pricing-table"
    >
      {plans.map((plan) => (
        <div
          key={plan.id.toString()}
          className={`arcenpay-plan-card ${selectedPlan === plan.id ? "selected" : ""}`}
          onClick={() => handleSelect(plan.id)}
        >
          <div className="arcenpay-plan-tier">{plan.tier.toUpperCase()}</div>
          <h3 className="arcenpay-plan-name">{plan.name}</h3>
          <div className="arcenpay-plan-price">
            <span className="arcenpay-plan-amount">{formatPrice(plan.price)}</span>
            <span className="arcenpay-plan-interval">
              {formatInterval(plan.billingInterval)}
            </span>
          </div>
          <div className="arcenpay-plan-token-label">
            <span className="arcenpay-plan-token-dot" />
            USDC · Stablecoin
          </div>
          <button
            className="arcenpay-plan-select-btn"
            onClick={(e) => {
              e.stopPropagation();
              handleSelect(plan.id);
            }}
          >
            {selectedPlan === plan.id ? "✓ Selected" : "Get Started"}
          </button>
        </div>
      ))}

      {/* Powered by Arcenpay */}
      <div className="arcenpay-pricing-footer" style={{ gridColumn: "1 / -1" }}>
        <a
          href="https://arcenpay.xyz"
          target="_blank"
          rel="noopener noreferrer"
          className="arcenpay-badge"
        >
          <span className="arcenpay-badge-dot" />
          Powered by Arcenpay
        </a>
      </div>
    </div>
  );
}
