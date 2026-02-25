'use client';

import React, { type ReactNode } from 'react';
import { useEntitlement } from '../hooks/useEntitlement';

// ============================================================
//  FeatureFlagGuard — Conditional rendering based on entitlements
// ============================================================

interface FeatureFlagGuardProps {
  featureKey: string;
  walletAddress: string;
  children: ReactNode;
  fallback?: ReactNode;
  className?: string;
}

/**
 * FeatureFlagGuard — Wraps premium UI elements.
 * Checks wallet's entitlement via on-chain state.
 * Renders children if entitled, fallback otherwise.
 *
 * @example
 * ```tsx
 * <FeatureFlagGuard featureKey="advanced_analytics" walletAddress={address}>
 *   <AdvancedDashboard />
 * </FeatureFlagGuard>
 * ```
 */
export function FeatureFlagGuard({
  featureKey,
  walletAddress,
  children,
  fallback = null,
  className = '',
}: FeatureFlagGuardProps) {
  const { features, isSubscribed, isLoading } = useEntitlement(walletAddress, featureKey);

  if (isLoading) {
    return (
      <div className={`meap-guard-loading ${className}`}>
        <div className="meap-spinner" />
      </div>
    );
  }

  // Check if the specific feature is enabled
  const hasFeature = isSubscribed && features[featureKey] === true;

  if (hasFeature) {
    return <>{children}</>;
  }

  return <>{fallback}</>;
}
