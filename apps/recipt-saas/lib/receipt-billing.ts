import type { UserResource } from "@clerk/types";

export const SCAN_FEATURE_KEY = "scan";
export const AI_SUMMARY_FEATURE_KEY = "ai_summery";

type ReceiptBillingIdentityInput = {
  clerkUserId: string;
  email?: string | null;
  name?: string | null;
  walletAddress?: string | null;
};

export function buildReceiptCompanyIdentity(
  input: ReceiptBillingIdentityInput,
) {
  return {
    id: input.clerkUserId,
    email: input.email ?? undefined,
    name: input.name ?? undefined,
    wallet: input.walletAddress ?? undefined,
  };
}

export function buildReceiptUserIdentity(input: ReceiptBillingIdentityInput) {
  return {
    id: input.clerkUserId,
    clerkUserId: input.clerkUserId,
    email: input.email ?? undefined,
    name: input.name ?? undefined,
    wallet: input.walletAddress ?? undefined,
  };
}

export function formatWalletAddress(walletAddress?: string | null) {
  if (!walletAddress) {
    return "Not connected";
  }

  return `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;
}

export function formatScanAllowance(
  allocation?: number | null,
  usage?: number | null,
) {
  const safeUsage = usage ?? 0;

  if (allocation == null) {
    return `${safeUsage} used`;
  }

  return `${safeUsage} / ${allocation} scans`;
}

export function hasActiveEntitlement(
  entitlement?: {
    enabled: boolean;
    exceeded: boolean;
  } | null,
) {
  return Boolean(entitlement?.enabled && !entitlement?.exceeded);
}

export function getClerkWalletAddress(
  user: Pick<
    UserResource,
    "primaryWeb3Wallet" | "verifiedWeb3Wallets" | "web3Wallets"
  > | null | undefined,
) {
  return (
    user?.primaryWeb3Wallet?.web3Wallet ??
    user?.verifiedWeb3Wallets[0]?.web3Wallet ??
    user?.web3Wallets[0]?.web3Wallet ??
    null
  );
}
