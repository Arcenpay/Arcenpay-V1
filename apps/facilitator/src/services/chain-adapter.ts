// ============================================================
//  ArcenPay Facilitator — Chain Adapter Interface
//
//  The facilitator historically assumed a single chain family (EVM) and
//  reached directly for viem everywhere: `getLogs`, `readContract`,
//  `writeContract`, `parseEventLogs`. Adding Stellar (Soroban) and future
//  non-EVM chains requires a per-family adapter so the facilitator's
//  billing-event ingestion, keeper, and settlement-writer logic can be
//  written against ONE seam and dispatch to the right SDK.
//
//  Design rules
//  ─────────────
//  • Every method takes the chainId it operates on. The adapter resolves
//    the right RPC client / contract addresses internally; callers do not
//    know which SDK is in use.
//  • Adapters MUST be idempotent and return typed results — no fire-and-
//    forget side effects at this layer. Idempotency keys are owned by the
//    caller (the facilitator's persistBillingEvent path).
//  • Methods are async; storage and RPC failures propagate as throws.
//  • The adapter does NOT own the durable job queue or webhook delivery.
//    Those remain facilitator-level concerns and consume adapter output.
//
//  Adding a new family
//  ───────────────────
//  1. Implement `ChainAdapter` for the family (see `evm-adapter.ts` for
//     reference, `stellar-adapter.ts` for the in-progress Stellar port).
//  2. Register it in `getChainAdapter()` below.

import type { ChainFamily } from "@arcenpay/internal-core";

// ─── Normalised event types ────────────────────────────────────────────────
//
// These mirror the existing `SubscriptionEventData` from services/events.ts
// but are family-agnostic. Every adapter maps its native chain events into
// this shape so the facilitator's billing-event pipeline stays unchanged.

export type NormalisedSubscriptionEventType =
  | "minted"
  | "renewed"
  | "cancelled"
  | "plan_changed"
  | "billing_executed";

export interface NormalisedSubscriptionEvent {
  type: NormalisedSubscriptionEventType;
  /** Subscription token id (EVM uint256 / Stellar u128) — stringified. */
  tokenId: string;
  /** Subscriber wallet address (family-encoded: 0x… for EVM, G… for Stellar). */
  subscriber?: string;
  /** On-chain plan id — stringified. */
  planId?: string;
  /** Previous plan id (plan-change events). */
  previousPlanId?: string;
  /** New subscription expiration (unix seconds). */
  expiration?: number;
  /** Gross amount paid in micros (1 USDC = 1_000_000), or 0 if N/A. */
  amountPaidMicros?: string;
  /** Merchant/recipient wallet (family-encoded). */
  account?: string;
  merchant?: string;
  /** Numeric billing-reason code (EVM uint8; Stellar enum). */
  billingReason?: number;
  /** Net merchant amount after fees, micros. */
  merchantAmountMicros?: string;
  /** Protocol fee amount, micros. */
  protocolFeeMicros?: string;
  /** Family-encoded transaction hash. EVM: 0x…64 hex. Stellar: 64 hex (no 0x). */
  transactionHash: string;
  /** Ledger/block number containing the event. */
  blockNumber: string;
  /** Event timestamp in unix seconds. */
  timestamp: number;
}

export type EventCallback = (
  event: NormalisedSubscriptionEvent,
) => void | Promise<void>;

// ─── Adapter interface ────────────────────────────────────────────────────

export interface ChainAdapter {
  /** Chain family this adapter serves. */
  readonly family: ChainFamily;

  /** The chainId this adapter instance is configured for. */
  readonly chainId: number;

  /**
   * Begin polling the chain for subscription events and dispatch to the
   * registered callbacks. Idempotent: starting twice is a no-op.
   *
   * Resolves once the poller is armed (NOT once events are consumed).
   */
  startEventListener(intervalMs?: number): Promise<void>;

  /** Stop the event poller. Safe to call when not running. */
  stopEventListener(): void;

  /**
   * Register a callback for a specific event type (or '*' for all). Returns
   * an unsubscribe function. Callbacks MUST be cheap — adapters do not
   * guarantee ordering across callback types.
   */
  on(
    eventType: NormalisedSubscriptionEventType | "*",
    callback: EventCallback,
  ): () => void;

  /**
   * Return the on-chain subscription owner wallet for a token id, or null if
   * the token does not exist. Used by the facilitator's subscription sync.
   *
   * EVM: `SubscriptionRegistry.ownerOf(tokenId)`.
   * Stellar: `subscription_registry.get_subscription(tokenId).owner`.
   */
  getSubscriptionOwner(tokenId: string): Promise<string | null>;

  /**
   * Returns true if the subscription is still active (not expired, not
   * cancelled). Family-agnostic boolean.
   */
  isSubscriptionValid(tokenId: string): Promise<boolean>;

  /**
   * Lookup a subscriber's email — kept on the adapter so per-family lookup
   * paths can vary (e.g. Stellar may post subscriber emails off-chain via a
   * different contract). Default impl returns null; EVM adapter delegates to
   * the facilitator's existing lookupSubscriberEmail path (set at construct).
   */
  lookupSubscriberEmail?(walletAddress: string): Promise<string | null>;
}

// ─── Adapter registry ──────────────────────────────────────────────────────

import { getChainFamily } from "@arcenpay/internal-core";

const adapterRegistry = new Map<number, ChainAdapter>();

/**
 * Registers a ChainAdapter for a chainId. Called once at facilitator boot
 * for each chain the facilitator is configured to watch.
 */
export function registerChainAdapter(adapter: ChainAdapter): void {
  const existing = adapterRegistry.get(adapter.chainId);
  if (existing && existing !== adapter) {
    console.warn(
      `[ChainAdapter] Replacing existing adapter for chainId ${adapter.chainId} ` +
        `(family ${existing.family} -> ${adapter.family}).`,
    );
  }
  adapterRegistry.set(adapter.chainId, adapter);
}

/**
 * Returns the registered adapter for a chainId, or null if none is
 * registered. Callers that need a hard guarantee should use
 * `requireChainAdapter`.
 */
export function getChainAdapter(chainId: number): ChainAdapter | null {
  return adapterRegistry.get(chainId) ?? null;
}

/**
 * Returns the registered adapter for a chainId, throwing if none is
 * registered. Use this in call paths that have no graceful fallback.
 */
export function requireChainAdapter(chainId: number): ChainAdapter {
  const adapter = adapterRegistry.get(chainId);
  if (!adapter) {
    const family = getChainFamily(chainId);
    const familyLabel = family ? family.toUpperCase() : "unknown";
    throw new Error(
      `[requireChainAdapter] No ChainAdapter registered for chainId ${chainId} ` +
        `(family ${familyLabel}). Register one via registerChainAdapter() at boot.`,
    );
  }
  return adapter;
}

/** Returns the chainIds for which adapters are currently registered. */
export function getRegisteredAdapterChainIds(): number[] {
  return Array.from(adapterRegistry.keys());
}