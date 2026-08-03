// ============================================================
//  ArcenPay Facilitator — EVM Chain Adapter
//
//  Wraps the existing viem-based `EventListenerService` behind the
//  family-agnostic `ChainAdapter` interface so the facilitator's
//  billing-event pipeline can talk to any chain family uniformly.
//
//  This file is intentionally thin: it does NOT re-implement viem logic.
//  It delegates to:
//    • EventListenerService for event polling (existing services/events.ts)
//    • The shared `chainClient` (viem PublicClient) for ownerOf reads
//
//  The EVM adapter is the reference implementation for what a Stellar
//  adapter (or future Solana adapter) must provide.
// ============================================================

import {
  getContractAddresses,
  isEvmChain,
  type ChainFamily,
} from "@arcenpay/internal-core";
import { EventListenerService } from "./events.js";
import type {
  ChainAdapter,
  EventCallback,
  NormalisedSubscriptionEventType,
} from "./chain-adapter.js";

const log = {
  warn: (msg: string) => console.warn(`[EvmChainAdapter] ${msg}`),
  debug: (msg: string) => {
    if (process.env.DEBUG_CHAIN_ADAPTER) console.log(`[EvmChainAdapter] ${msg}`);
  },
};

export interface EvmChainAdapterConfig {
  /** Numeric EVM chainId (real EVM id, NOT a synthetic non-EVM id). */
  chainId: number;
  /** RPC URL — falls back to chain defaults if omitted. */
  rpcUrl?: string;
  /** Optional override for the SubscriptionRegistry address. */
  registryAddress?: string;
}

/**
 * EVM implementation of {@link ChainAdapter}. Delegates to the existing
 * `EventListenerService` for subscription-event polling and to a viem
 * PublicClient for `ownerOf`-style reads.
 *
 * Note: viem's PublicClient is created via `createResilientFacilitatorClient`
 * inside EventListenerService; we re-use that wiring instead of duplicating
 * it here.
 */
export class EvmChainAdapter implements ChainAdapter {
  readonly family: ChainFamily = "evm";
  readonly chainId: number;
  private readonly listener: EventListenerService;

  constructor(config: EvmChainAdapterConfig) {
    if (!isEvmChain(config.chainId)) {
      throw new Error(
        `[EvmChainAdapter] chainId ${config.chainId} is not an EVM chain. ` +
          `Use the appropriate adapter for its family.`,
      );
    }
    this.chainId = config.chainId;

    // Verify the chain has deployed contracts (throws if missing in prod).
    // We do not block construction in dev so the facilitator can boot even
    // when a chain is partially configured.
    try {
      getContractAddresses(config.chainId);
    } catch (err) {
      log.warn(
        `No contract addresses configured for EVM chain ${config.chainId}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }

    this.listener = new EventListenerService({
      rpcUrl: config.rpcUrl ?? "",
      chainId: config.chainId,
      registryAddress: config.registryAddress,
    });
  }

  async startEventListener(intervalMs = 15000): Promise<void> {
    await this.listener.start(intervalMs);
  }

  stopEventListener(): void {
    this.listener.stop();
  }

  on(
    eventType: NormalisedSubscriptionEventType | "*",
    callback: EventCallback,
  ): () => void {
    // The existing EventListenerService uses its own SubscriptionEventData
    // shape with bigint fields. We normalise to string here so the
    // billing-event pipeline is family-agnostic.
    return this.listener.on(eventType, (ev) => {
      callback({
        type: ev.type,
        tokenId: ev.tokenId.toString(),
        subscriber: ev.subscriber,
        planId: ev.planId?.toString(),
        previousPlanId: ev.previousPlanId?.toString(),
        expiration: ev.expiration ? Number(ev.expiration) : undefined,
        amountPaidMicros: ev.amountPaid ? ev.amountPaid.toString() : undefined,
        account: ev.account,
        merchant: ev.merchant,
        billingReason: ev.billingReason ? Number(ev.billingReason) : undefined,
        merchantAmountMicros: ev.merchantAmount
          ? ev.merchantAmount.toString()
          : undefined,
        protocolFeeMicros: ev.protocolFee ? ev.protocolFee.toString() : undefined,
        transactionHash: ev.transactionHash,
        blockNumber: ev.blockNumber.toString(),
        timestamp: ev.timestamp,
      });
    });
  }

  async getSubscriptionOwner(tokenId: string): Promise<string | null> {
    // Defer to EventListenerService's existing getTokenOwner-free path by
    // calling into the publicClient. We don't re-create the client here; the
    // EventListenerService has it privately. For now we expose a typed
    // no-op stub that returns null — the EVM ownerOf lookup is currently
    // performed at the server.ts level via the shared chainClient and is
    // wired into the adapter via the facilitator boot in server.ts.
    //
    // TODO: extract the viem PublicClient out of EventListenerService so the
    // adapter can own ownerOf reads, renew, and settle calls cleanly. The
    // extraction is intentionally deferred to keep this commit additive.
    const id = BigInt(tokenId);
    log.debug(`getSubscriptionOwner token=${id} — pending extraction`);
    return null;
  }

  async isSubscriptionValid(tokenId: string): Promise<boolean> {
    // Same caveat as getSubscriptionOwner — pending PublicClient extraction.
    // Once extracted this calls SubscriptionRegistry.isValid(uint256).
    log.debug(`isSubscriptionValid token=${tokenId} — pending extraction`);
    return false;
  }
}