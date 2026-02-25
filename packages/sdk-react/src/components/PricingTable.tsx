'use client';

import React, { useEffect, useState, useCallback } from 'react';
import type { Plan } from '@meap/core';
import { useMEAP } from '../providers/MEAPProvider';

// ============================================================
//  PricingTable — Displays subscription plan tiers
// ============================================================

interface PricingTableProps {
  planIds: bigint[];
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
 *   planIds={[1n, 2n, 3n]}
 *   onSelectPlan={(planId) => console.log('Selected:', planId)}
 * />
 * ```
 */
export function PricingTable({
  planIds,
  onSelectPlan,
  theme = 'dark',
  className = '',
}: PricingTableProps) {
  const { contracts } = useMEAP();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPlan, setSelectedPlan] = useState<bigint | null>(null);

  useEffect(() => {
    // TODO: Fetch plans from PlanFactory contract using viem
    // For now, using placeholder data structure
    setLoading(false);
  }, [planIds, contracts]);

  const handleSelect = useCallback((planId: bigint) => {
    setSelectedPlan(planId);
    onSelectPlan?.(planId);
  }, [onSelectPlan]);

  const formatPrice = (price: bigint) => {
    // USDC has 6 decimals
    const dollars = Number(price) / 1_000_000;
    return `$${dollars.toFixed(2)}`;
  };

  const formatInterval = (seconds: number) => {
    if (seconds === 2_592_000) return '/month';
    if (seconds === 31_536_000) return '/year';
    return `/${Math.floor(seconds / 86400)} days`;
  };

  if (loading) {
    return (
      <div className={`meap-pricing-loading ${className}`}>
        <div className="meap-spinner" />
        <p>Loading plans...</p>
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
