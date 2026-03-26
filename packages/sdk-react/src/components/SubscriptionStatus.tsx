"use client";

import React from "react";
import { useMEAP } from "../providers/MEAPProvider";
import { useEntitlement } from "../hooks/useEntitlement";

// ============================================================
//  SubscriptionStatus — Displays current subscription info
//  Stablecoin (USDC) payments only — all chains supported
// ============================================================

interface SubscriptionStatusProps {
  walletAddress: string;
  className?: string;
}

/**
 * SubscriptionStatus — Displays current subscription tier, expiry, and status
 */
export function SubscriptionStatus({
  walletAddress,
  className = "",
}: SubscriptionStatusProps) {
  const { isSubscribed, planTier, expiresAt, isLoading } =
    useEntitlement(walletAddress);

  if (isLoading) {
    return (
      <div className={`arcenpay-status-loading ${className}`}>
        <div className="arcenpay-spinner" />
      </div>
    );
  }

  const formatDate = (timestamp: bigint) => {
    return new Date(Number(timestamp) * 1000).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const isExpiringSoon = () => {
    if (!expiresAt) return false;
    const now = BigInt(Math.floor(Date.now() / 1000));
    const threeDays = 259_200n;
    return expiresAt - now < threeDays;
  };

  return (
    <div
      className={`arcenpay-subscription-status ${className}`}
      data-arcenpay-component="subscription-status"
    >
      {isSubscribed ? (
        <div className="arcenpay-status-active">
          <div className="arcenpay-status-badge active">Active</div>
          <div className="arcenpay-status-details">
            <div className="arcenpay-status-tier">
              {planTier?.toUpperCase()} Plan
            </div>
            <div className="arcenpay-status-expiry">
              {isExpiringSoon() ? "⚠ " : ""}
              Renews {formatDate(expiresAt!)}
            </div>
          </div>

          {/* USDC indicator */}
          <div
            style={{
              marginLeft: "auto",
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              gap: 4,
            }}
          >
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 10,
                fontWeight: 700,
                color: "var(--success)",
                background: "var(--success-dim)",
                border: "1px solid rgba(34,197,94,0.2)",
                padding: "2px 7px",
                borderRadius: 20,
                letterSpacing: "0.04em",
              }}
            >
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: "50%",
                  background: "var(--success)",
                  flexShrink: 0,
                  display: "inline-block",
                }}
              />
              USDC
            </div>
          </div>
        </div>
      ) : (
        <div className="arcenpay-status-inactive">
          <div className="arcenpay-status-badge inactive">Inactive</div>
          <p>No active subscription</p>
        </div>
      )}

      {/* Powered by Arcenpay */}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          marginTop: 10,
          paddingTop: 10,
          borderTop: "1px solid var(--border-dim)",
        }}
      >
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
