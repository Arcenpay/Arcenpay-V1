// ============================================================
//  Dashboard — Direct-Chain Reader
//
//  Read-path policy:
//    - Subgraph (Apollo / graphql.ts): analytics, aggregates,
//      paginated history, billing events.  May lag 1-2 blocks.
//    - This module (viem): user-critical entitlement checks and
//      live session balances.  Always reads from chain tip.
//
//  Use these helpers wherever correctness matters more than speed
//  (e.g., gate-keeping feature access, live balance display).
// ============================================================

import { createPublicClient, http, type Address } from "viem";
import {
  SubscriptionRegistryABI,
  SessionVaultABI,
  MirrorRegistryABI,
  getContractAddresses,
} from "@meap/core";
import { getRpcUrl } from "@/lib/config";

// ── Internal helpers ──────────────────────────────────────────

function makeClient(chainId: number) {
  const rpcUrl = getRpcUrl(chainId);
  if (!rpcUrl) {
    throw new Error(
      `[chain-reader] No RPC URL configured for chain ${chainId}. ` +
        `Set RPC_URL_${chainId} or RPC_URL in environment.`,
    );
  }
  return createPublicClient({ transport: http(rpcUrl, { timeout: 8_000 }) });
}

// ── Subscription entitlement ─────────────────────────────────

export interface SubscriptionStatus {
  /** Whether the subscription NFT exists and has not expired */
  active: boolean;
  /** Unix timestamp (seconds) when the subscription expires; 0 if not found */
  expiration: number;
  /** Plan ID the subscription is bound to */
  planId: bigint;
}

/**
 * Reads the live subscription status for a given NFT token ID directly from
 * the SubscriptionRegistry contract.  Use this for entitlement gate-keeping
 * where a 1-2 block subgraph lag is not acceptable.
 *
 * Makes 3 parallel contract reads: isValid, expiresAt, getPlanFeatures.
 */
export async function getSubscriptionStatus(
  tokenId: bigint,
  chainId: number,
): Promise<SubscriptionStatus> {
  const client = makeClient(chainId);
  const { subscriptionRegistry } = getContractAddresses(chainId);
  const addr = subscriptionRegistry as Address;

  const [active, expiration, features] = await Promise.all([
    client.readContract({
      address: addr,
      abi: SubscriptionRegistryABI,
      functionName: "isValid",
      args: [tokenId],
    }) as Promise<boolean>,
    client.readContract({
      address: addr,
      abi: SubscriptionRegistryABI,
      functionName: "expiresAt",
      args: [tokenId],
    }) as Promise<bigint>,
    client.readContract({
      address: addr,
      abi: SubscriptionRegistryABI,
      functionName: "getPlanFeatures",
      args: [tokenId],
    }) as Promise<readonly [bigint, string]>,
  ]);

  return {
    active,
    expiration: Number(expiration),
    planId: features[0],
  };
}

// ── Session vault balance ────────────────────────────────────

export interface SessionBalance {
  /** Total deposited USDC (atomic units, 6 decimals) */
  totalFunded: bigint;
  /** Current spendable balance (atomic units) */
  currentBalance: bigint;
  /** Whether the session is still active */
  active: boolean;
}

/**
 * Reads the live session balance directly from SessionVault.
 * Use for displaying real-time agent session state where subgraph lag would
 * show stale data.
 */
export async function getSessionBalance(
  sessionId: `0x${string}`,
  chainId: number,
): Promise<SessionBalance> {
  const client = makeClient(chainId);
  const { sessionVault } = getContractAddresses(chainId);

  const result = await client.readContract({
    address: sessionVault as Address,
    abi: SessionVaultABI,
    functionName: "getSession",
    args: [sessionId],
  });

  const session = result as {
    totalFunded: bigint;
    balance: bigint;
    active: boolean;
  };
  return {
    totalFunded: session.totalFunded,
    currentBalance: session.balance,
    active: session.active,
  };
}

// ── Mirror registry (cross-chain entitlement) ────────────────

export interface MirroredSubscriptionStatus {
  /** Whether the mirrored subscription is valid (not expired) */
  valid: boolean;
  /** Unix timestamp (seconds) when the mirrored subscription expires; 0 if none */
  expiration: number;
  /** Plan tier string (e.g. "pro", "enterprise") */
  planTier: string;
  /** Source chain the subscription originates from */
  sourceChainId: bigint;
}

/**
 * Checks the MirrorRegistry on the target chain to see if a subscriber has
 * a valid cross-chain entitlement.  Used when the subscriber holds a
 * subscription on a different chain from the one being checked.
 */
export async function getMirroredSubscriptionStatus(
  subscriber: Address,
  chainId: number,
): Promise<MirroredSubscriptionStatus> {
  const client = makeClient(chainId);
  const addresses = getContractAddresses(chainId);
  const mirrorAddress = addresses.mirrorRegistry as Address | undefined;

  if (
    !mirrorAddress ||
    mirrorAddress === "0x0000000000000000000000000000000000000000"
  ) {
    return { valid: false, expiration: 0, planTier: "", sourceChainId: 0n };
  }

  const [valid, expiration, planTier] = await Promise.all([
    client.readContract({
      address: mirrorAddress,
      abi: MirrorRegistryABI,
      functionName: "isValid",
      args: [subscriber],
    }) as Promise<boolean>,
    client.readContract({
      address: mirrorAddress,
      abi: MirrorRegistryABI,
      functionName: "expiresAt",
      args: [subscriber],
    }) as Promise<bigint>,
    client.readContract({
      address: mirrorAddress,
      abi: MirrorRegistryABI,
      functionName: "getPlanTier",
      args: [subscriber],
    }) as Promise<string>,
  ]);

  return {
    valid,
    expiration: Number(expiration),
    planTier,
    sourceChainId: 0n, // Full mirror struct available via getMirror() if needed
  };
}
