"use client";

import { useArcenPay } from "@arcenpay/react";
import { useUser } from "@clerk/nextjs";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import {
  AI_SUMMARY_FEATURE_KEY,
  formatPlanLabel,
  formatScanAllowance,
  getClerkWalletAddress,
  hasActiveEntitlement,
  normalizeWalletAddress,
  SCAN_FEATURE_KEY,
} from "@/lib/receipt-billing";
import { useArcenActivePlan } from "@/hooks/use-arcen-active-plan";
import { useArcenCompanyEntitlements } from "@/hooks/use-arcen-company-entitlements";

function useReceiptBillingValue() {
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
  const aiSummaryEntitlement =
    entitlements[AI_SUMMARY_FEATURE_KEY] ?? null;
  const isSubscribed = hasActiveEntitlement(scanEntitlement);
  const {
    activePlan,
    error: activePlanError,
    loading: activePlanLoading,
    refetch: refetchActivePlan,
  } = useArcenActivePlan({
    skip: !session.token || !isSubscribed,
  });
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
  const allocation = scanEntitlement?.allocation ?? null;
  const usage = scanEntitlement?.usage ?? 0;
  const reasonPlanName = scanEntitlement?.reason?.match(
    /\bplan[_-]([a-z0-9][a-z0-9_-]*)/i,
  )?.[1];
  const planName =
    formatPlanLabel(activePlan?.name) ??
    formatPlanLabel(isSubscribed ? reasonPlanName : null) ??
    (isSubscribed ? "Active subscription" : null);
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
  const refetchEntitlementData = useCallback(() => {
    refetch();
  }, [refetch]);

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
  }, [
    session.company?.id,
    session.company?.wallet,
    session.token,
    session.user?.clerkUserId,
    session.user?.id,
    user,
    walletAddress,
    walletMismatch,
  ]);

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
    isEntitlementLoading: loading,
    isPlanLoading: activePlanLoading,
    isIdentified,
    isLoaded,
    isSignedIn: Boolean(user),
    isSubscribed,
    identityError: session.identifyError,
    isIdentifying: session.isIdentifying,
    liveWalletAddress,
    planError: activePlanError,
    planName,
    planTier: planName,
    refetchActivePlan,
    refetchEntitlements: refetchEntitlementData,
    scanEntitlement,
    scanEntitlementError: error,
    usage,
    usageLabel: formatScanAllowance(allocation, usage),
    usagePercentage,
    walletAddress,
    walletConnecting,
    walletError: null,
    walletMismatch,
    walletRequired: Boolean(user) && !walletMismatch && !walletAddress,
  };
}

type ReceiptBillingContextValue = ReturnType<typeof useReceiptBillingValue>;

const ReceiptBillingContext =
  createContext<ReceiptBillingContextValue | null>(null);

export function ReceiptBillingProvider({
  children,
}: {
  children: ReactNode;
}) {
  const value = useReceiptBillingValue();

  return (
    <ReceiptBillingContext.Provider value={value}>
      {children}
    </ReceiptBillingContext.Provider>
  );
}

export function useReceiptBilling() {
  const context = useContext(ReceiptBillingContext);

  if (!context) {
    throw new Error(
      "useReceiptBilling must be used within a <ReceiptBillingProvider>.",
    );
  }

  return context;
}
