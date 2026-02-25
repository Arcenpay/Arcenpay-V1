'use client';

import React from 'react';
import type { Subscription } from '@meap/core';
import { useMEAP } from '../providers/MEAPProvider';
import { useEntitlement } from '../hooks/useEntitlement';

// ============================================================
//  SubscriptionStatus — Displays current subscription info
// ============================================================

interface SubscriptionStatusProps {
  walletAddress: string;
  className?: string;
}

/**
 * SubscriptionStatus — Displays current subscription tier, expiry, and status
 */
export function SubscriptionStatus({ walletAddress, className = '' }: SubscriptionStatusProps) {
  const { isSubscribed, planTier, expiresAt, isLoading } = useEntitlement(walletAddress);

  if (isLoading) {
    return (
      <div className={`meap-status-loading ${className}`}>
        <div className="meap-spinner" />
      </div>
    );
  }

  const formatDate = (timestamp: bigint) => {
    return new Date(Number(timestamp) * 1000).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const isExpiringSoon = () => {
    if (!expiresAt) return false;
    const now = BigInt(Math.floor(Date.now() / 1000));
    const threeDays = 259_200n;
    return expiresAt - now < threeDays;
  };

  return (
    <div className={`meap-subscription-status ${className}`} data-meap-component="subscription-status">
      {isSubscribed ? (
        <div className="meap-status-active">
          <div className="meap-status-badge active">Active</div>
          <div className="meap-status-details">
            <div className="meap-status-tier">{planTier?.toUpperCase()} Plan</div>
            <div className="meap-status-expiry">
              {isExpiringSoon() ? '⚠️ ' : ''}
              Renews {formatDate(expiresAt!)}
            </div>
          </div>
        </div>
      ) : (
        <div className="meap-status-inactive">
          <div className="meap-status-badge inactive">Inactive</div>
          <p>No active subscription</p>
        </div>
      )}
    </div>
  );
}
