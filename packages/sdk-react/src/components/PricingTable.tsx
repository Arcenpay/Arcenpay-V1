'use client';

import React, { useState, useCallback } from 'react';
import { useReadContract, useReadContracts } from 'wagmi';
import type { Plan } from '@meap/core';
import { PlanFactoryABI, getContractAddresses } from '@meap/core';
import { useMEAP } from '../providers/MEAPProvider';

// ============================================================
//  PricingTable — Displays subscription plan tiers
//  Fetches real plan data from PlanFactory contract
// ============================================================

interface PricingTableProps {
  /** Plan IDs to display, or provider address to fetch all plans */
  planIds?: bigint[];
  /** Provider address — if provided, fetches all plans for this provider */
  providerAddress?: string;
  onSelectPlan?: (planId: bigint) => void;
  theme?: 'light' | 'dark';
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
  theme = 'dark',
  className = '',
}: PricingTableProps) {
  const { network } = useMEAP();
  const contracts = getContractAddresses(network.chainId);
  const factoryAddress = contracts.planFactory as `0x${string}`;

  const [selectedPlan, setSelectedPlan] = useState<bigint | null>(null);

  // Fetch provider's plan IDs if providerAddress given (and no explicit IDs)
  const { data: fetchedPlanIds } = useReadContract({
    address: factoryAddress,
    abi: PlanFactoryABI,
    functionName: 'getProviderPlans',
    args: [providerAddress as `0x${string}`],
    chainId: network.chainId,
    query: { enabled: !!providerAddress && !explicitPlanIds },
  });

  const activePlanIds = explicitPlanIds || (fetchedPlanIds as bigint[]) || [];

  // Batch-fetch plan details for each plan ID
  const planContracts = activePlanIds.map((id) => ({
    address: factoryAddress,
    abi: PlanFactoryABI,
    functionName: 'getPlan' as const,
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

  const handleSelect = useCallback((planId: bigint) => {
    setSelectedPlan(planId);
    onSelectPlan?.(planId);
  }, [onSelectPlan]);

  const formatPrice = (price: bigint) => {
    const dollars = Number(price) / 1_000_000;
    return `$${dollars.toFixed(2)}`;
  };

  const formatInterval = (seconds: number) => {
    if (seconds >= 31_536_000) return '/year';
    if (seconds >= 7_776_000) return '/quarter';
    if (seconds >= 2_592_000) return '/month';
    return `/${Math.floor(seconds / 86400)} days`;
  };

  if (isLoading) {
    return (
      <div className={`meap-pricing-loading ${className}`}>
        <div className="meap-spinner" />
        <p>Loading plans from chain...</p>
      </div>
    );
  }

  if (plans.length === 0) {
    return (
      <div className={`meap-pricing-empty ${className}`}>
        <p>No active plans found.</p>
      </div>
    );
  }

  return (
    <div
      className={`meap-pricing-table ${theme} ${className}`}
      data-meap-component="pricing-table"
    >
      {plans.map((plan) => (
        <div
          key={plan.id.toString()}
          className={`meap-plan-card ${selectedPlan === plan.id ? 'selected' : ''}`}
          onClick={() => handleSelect(plan.id)}
        >
          <div className="meap-plan-tier">{plan.tier.toUpperCase()}</div>
          <h3 className="meap-plan-name">{plan.name}</h3>
          <div className="meap-plan-price">
            <span className="meap-plan-amount">{formatPrice(plan.price)}</span>
            <span className="meap-plan-interval">{formatInterval(plan.billingInterval)}</span>
          </div>
          <button
            className="meap-plan-select-btn"
            onClick={(e) => {
              e.stopPropagation();
              handleSelect(plan.id);
            }}
          >
            {selectedPlan === plan.id ? 'Selected' : 'Select Plan'}
          </button>
        </div>
      ))}
    </div>
  );
}
