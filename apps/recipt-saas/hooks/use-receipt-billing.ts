"use client";

import { useArcenPay, useEntitlement } from "@arcenpay/react";
import { useUser } from "@clerk/nextjs";
import { useMemo } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import {
  AI_SUMMARY_FEATURE_KEY,
  getClerkWalletAddress,
  hasActiveEntitlement,
  normalizeWalletAddress,
  SCAN_FEATURE_KEY,
  formatScanAllowance,
} from "@/lib/receipt-billing";
import { useArcenCompanyEntitlements } from "./use-arcen-company-entitlements";

export function useReceiptBilling() {
  const { user, isLoaded } = useUser();
  const { session } = useArcenPay();
  const { address, isConnected } = useAccount();
  const {
    connectAsync,
    connectors,
    isPending: walletConnecting,
  } = useConnect();
  const { disconnect } = useDisconnect();
  const { entitlements, loading, error, refetch } = useArcenCompanyEntitlements(
    {
      skip: !session.token,
    },
  );

  const clerkWalletAddress = useMemo(
    () => normalizeWalletAddress(getClerkWalletAddress(user)),
    [user],
  );
  const scanEntitlement = entitlements[SCAN_FEATURE_KEY] ?? null;
  const aiSummaryEntitlement = entitlements[AI_SUMMARY_FEATURE_KEY] ?? null;
  const liveWalletAddress = normalizeWalletAddress(
    isConnected ? address ?? null : null,
  );
  const sessionWalletAddress = normalizeWalletAddress(session.company?.wallet);
  const walletMismatch = Boolean(
    clerkWalletAddress &&
      liveWalletAddress &&
      clerkWalletAddress !== liveWalletAddress,
  );
  const walletAddress = walletMismatch
    ? null
    : clerkWalletAddress ?? liveWalletAddress ?? sessionWalletAddress ?? null;
  const scanAccess = useEntitlement(walletAddress ?? undefined, SCAN_FEATURE_KEY);
  const allocation = scanEntitlement?.allocation ?? null;
  const usage = scanEntitlement?.usage ?? 0;
  const usagePercentage =
    allocation && allocation > 0 ? Math.min((usage / allocation) * 100, 100) : 0;
  const preferredConnector =
    connectors.find((connector) => connector.type === "metaMask") ??
    connectors.find((connector) =>
      connector.name.toLowerCase().includes("metamask"),
    ) ??
    connectors.find((connector) => connector.type === "injected") ??
    connectors[0] ??
    null;

  const isIdentified = useMemo(() => {
    if (!user || !session.token || walletMismatch) {
      return false;
    }

    const sessionUserId =
      session.user?.clerkUserId ?? session.user?.id ?? session.company?.id;

    if (sessionUserId !== user.id) {
      return false;
    }

    if (!walletAddress) {
      return true;
    }

    return session.company?.wallet?.toLowerCase() === walletAddress.toLowerCase();
  }, [session.company?.id, session.company?.wallet, session.token, session.user?.clerkUserId, session.user?.id, user, walletAddress, walletMismatch]);

  return {
    allocation,
    aiSummaryEntitlement,
    canScan:
      Boolean(user) &&
      !walletMismatch &&
      Boolean(walletAddress) &&
      hasActiveEntitlement(scanEntitlement),
    canUseAiSummary:
      Boolean(user) &&
      !walletMismatch &&
      Boolean(walletAddress) &&
      hasActiveEntitlement(aiSummaryEntitlement),
    clerkWalletAddress,
    connectWallet: () => {
      if (!preferredConnector) {
        throw new Error("No wallet connector is available in this environment.");
      }

      return connectAsync({ connector: preferredConnector });
    },
    disconnectWallet: () => disconnect(),
    isEntitlementLoading: loading || scanAccess.isLoading,
    isIdentified,
    isLoaded,
    isSignedIn: Boolean(user),
    isSubscribed: scanAccess.isSubscribed,
    planTier: scanAccess.planTier,
    refetchEntitlements: refetch,
    scanEntitlement,
    scanEntitlementError: error,
    usage,
    usageLabel: formatScanAllowance(allocation, usage),
    usagePercentage,
    liveWalletAddress,
    walletAddress,
    walletConnecting,
    walletError: scanAccess.error,
    walletMismatch,
    walletRequired: Boolean(user) && !walletMismatch && !walletAddress,
  };
}
