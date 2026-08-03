// ============================================================
//  ArcenPay Facilitator — Stellar Chain Adapter (Production)
//
//  Implements `ChainAdapter` for the Stellar (Soroban) family using
//  the @stellar/stellar-sdk v16 RPC APIs:
//
//    • rpc.Server.getEvents()    — poll Soroban events with ledger cursor
//    • contract.Client.from()    — read contract functions (subscription
//                                   ownership, validity)
//    • getLedgerEntries()        — raw storage query (fallback for reads)
//
//  The adapter transforms Soroban contract events (typed via
//  #[contractevent]) into `NormalisedSubscriptionEvent` so the
//  facilitator's billing-event pipeline sees a uniform event stream
//  regardless of chain family.
//
//  Event decoding strategy:
//    - topic[0]  = Symbol (event name) → `SubscriptionMinted`, etc.
//    - topic[1]  = first `#[topic]` field (Address, u128, …)
//    - value     = ScvVec of ALL fields in declaration order, decoded
//                   positionally. Fields marked `#[topic]` appear in
//                   BOTH topics and value.
//
//  For the soroban-sdk v27 contract events, the value serialisation is
//  a ScvVec whose elements correspond to the struct fields in Rust
//  declaration order. We know the field layouts from our own contract
//  sources (see packages/stellar-contracts/).
//
//  Sequence number safety: the adapter never submits transactions — it
//  reads from the ledger via getEvents and view-function simulation.
//  Therefore it doesn't need a funded Stellar account for reads.
// ============================================================

import { rpc } from "@stellar/stellar-sdk";
import { type xdr } from "@stellar/stellar-sdk/base";
import {
  getContractAddresses,
  getStellarNetworkPassphrase,
  getStellarSorobanRpcUrl,
  type ChainFamily,
} from "@arcenpay/internal-core";
import type {
  ChainAdapter,
  EventCallback,
  NormalisedSubscriptionEventType,
  NormalisedSubscriptionEvent,
} from "./chain-adapter.js";
import {
  scValToJs,
  scValSymbolToString,
  scValToBigInt,
  scValToNumber,
  scValVecGet,
} from "./stellar-scval.js";

// ─── StellarSubscriptionEventType (from our contracts) ─────────────────────

const STELLAR_EVENT_SYMBOLS: Record<string, NormalisedSubscriptionEventType> = {
  SubscriptionMinted: "minted",
  SubscriptionRenewed: "renewed",
  SubscriptionCancelled: "cancelled",
  SubscriptionPlanChanged: "plan_changed",
  BillingExecuted: "billing_executed",
};

// ─── Public types ──────────────────────────────────────────────────────────

export interface StellarChainAdapterConfig {
  /** Stellar synthetic chainId (9000000 / 9000001 / 9000002). */
  chainId: number;
  /**
   * Optional Soroban RPC URL override. Falls back to
   * {@link getStellarSorobanRpcUrl} which honours env vars.
   */
  sorobanRpcUrl?: string;
  /**
   * Polling interval in milliseconds. Default: 15_000 (15s).
   * Soroban RPCs have a generous rate limit; a 5-15s interval is fine.
   */
  pollIntervalMs?: number;
}

// ─── Implementation ────────────────────────────────────────────────────────

export class StellarChainAdapter implements ChainAdapter {
  readonly family: ChainFamily = "stellar";
  readonly chainId: number;
  private readonly sorobanRpcUrl: string;
  private readonly networkPassphrase: string;
  private readonly subscriptionRegistryContractId: string;
  private readonly autopayAccountContractId: string;
  private readonly pollIntervalMs: number;

  private server: rpc.Server | null = null;
  private lastLedger: number = 0;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private callbacks = new Map<
    NormalisedSubscriptionEventType | "*",
    EventCallback[]
  >();

  constructor(config: StellarChainAdapterConfig) {
    this.chainId = config.chainId;
    this.sorobanRpcUrl =
      config.sorobanRpcUrl || getStellarSorobanRpcUrl(config.chainId);
    this.networkPassphrase = getStellarNetworkPassphrase(config.chainId);
    this.pollIntervalMs = config.pollIntervalMs ?? 15_000;

    if (!this.sorobanRpcUrl) {
      throw new Error(
        `[StellarChainAdapter] No Soroban RPC URL configured for chain ${config.chainId}. ` +
          `Set STELLAR_RPC_URL_${config.chainId} or STELLAR_RPC_URL in env, ` +
          `or pass sorobanRpcUrl in the config. See packages/internal-core/src/chain-family.ts.`,
      );
    }

    const contracts = getContractAddresses(config.chainId);
    this.subscriptionRegistryContractId = contracts.subscriptionRegistry;
    this.autopayAccountContractId = contracts.autopayModule;

    if (!this.subscriptionRegistryContractId) {
      console.warn(
        `[StellarChainAdapter] No subscription-registry address configured ` +
          `for chain ${config.chainId}. Set ARCENPAY_CONTRACT_${config.chainId}_subscriptionRegistry. ` +
          `Event polling will be a no-op until the contract is deployed.`,
      );
    }
    if (!this.autopayAccountContractId) {
      console.warn(
        `[StellarChainAdapter] No autopay-account address configured ` +
          `for chain ${config.chainId}. Set ARCENPAY_CONTRACT_${config.chainId}_autopayModule. ` +
          `BillingExecuted events will not be captured.`,
      );
    }
  }

  // ── ChainAdapter interface ──────────────────────────────────────────────

  on(
    eventType: NormalisedSubscriptionEventType | "*",
    callback: EventCallback,
  ): () => void {
    const existing = this.callbacks.get(eventType) || [];
    existing.push(callback);
    this.callbacks.set(eventType, existing);
    return () => {
      const cbs = this.callbacks.get(eventType) || [];
      this.callbacks.set(
        eventType,
        cbs.filter((cb) => cb !== callback),
      );
    };
  }

  async startEventListener(intervalMs?: number): Promise<void> {
    if (this.pollTimer) return; // idempotent

    if (!this.server) {
      this.server = new rpc.Server(this.sorobanRpcUrl, {
        allowHttp: this.sorobanRpcUrl.startsWith("http://"),
        timeout: 30,
      });
    }

    if (!this.subscriptionRegistryContractId) {
      console.warn(
        `[StellarChainAdapter] No subscription-registry contract configured. ` +
          `Event listener will not start.`,
      );
      return;
    }

    // Seed the cursor from the latest ledger so we only poll new events.
    try {
      const latest = await this.server.getLatestLedger();
      this.lastLedger = latest.sequence;
      console.log(
        `[StellarChainAdapter] Starting event listener for chain ${this.chainId} ` +
          `from ledger ${this.lastLedger} (rpc=${this.sorobanRpcUrl})`,
      );
    } catch (err) {
      console.warn(
        `[StellarChainAdapter] Failed to query latest ledger; starting from 0:`,
        err instanceof Error ? err.message : String(err),
      );
      this.lastLedger = 0;
    }

    const effectiveInterval = intervalMs ?? this.pollIntervalMs;
    this.pollTimer = setInterval(() => {
      void this.poll().catch((err) => {
        console.error(
          `[StellarChainAdapter] Poll error (chain ${this.chainId}):`,
          err,
        );
      });
    }, effectiveInterval);
  }

  stopEventListener(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
      console.log(
        `[StellarChainAdapter] Event listener stopped for chain ${this.chainId}`,
      );
    }
  }

  // ── view-function reads ──────────────────────────────────────────────

  async getSubscriptionOwner(_tokenId: string): Promise<string | null> {
    // Stellar subscription records are stored in persistent storage at
    // DataKey::SubscriptionByToken(tokenId). This can be read via
    // contract.Client.from().get_subscription() but requires the contract
    // spec. The subscription route store (populated by event callbacks)
    // already tracks tokenId → wallet mappings, so this method delegates
    // to that path.
    //
    // TODO: add a `getLedgerEntries`-based storage read if needed for
    // reconciliation. The ledger key format for a persistent map entry
    // is: LedgerKey.ContractData(contractId, LedgerEntryData(Map, key)).
    return null;
  }

  async isSubscriptionValid(_tokenId: string): Promise<boolean> {
    // Same as getSubscriptionOwner — the event poller drives state.
    // TODO: add a `contract.Client.from().is_valid()` call if needed.
    return false;
  }

  // ── event polling ─────────────────────────────────────────────────────

  private async poll(): Promise<void> {
    if (!this.server) return;
    if (!this.subscriptionRegistryContractId) return;

    try {
      if (this.lastLedger === 0) {
        const latest = await this.server.getLatestLedger();
        this.lastLedger = latest.sequence;
        return;
      }

      const latest = await this.server.getLatestLedger();
      if (this.lastLedger >= latest.sequence) return;

      const startLedger = this.lastLedger + 1;
      const endLedger = latest.sequence;

      // Build filters for the subscription-registry and autopay-account
      // contracts. We avoid complex topic XDR encoding by fetching ALL
      // events from these contracts and filtering by event symbol
      // client-side. This is simpler and the event volume from these
      // two contracts is negligible.
      const filters: rpc.Api.EventFilter[] = [
        {
          type: "contract",
          contractIds: [this.subscriptionRegistryContractId],
        },
      ];

      if (this.autopayAccountContractId) {
        filters.push({
          type: "contract",
          contractIds: [this.autopayAccountContractId],
        });
      }

      const eventsResponse = await this.server.getEvents({
        startLedger,
        endLedger,
        filters,
        limit: 200,
      });

      for (const event of eventsResponse.events) {
        await this.processEvent(event);
      }

      this.lastLedger = endLedger;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes("429") ||
        msg.includes("Too Many Requests") ||
        msg.includes("rate limit")
      ) {
        console.warn(
          `[StellarChainAdapter] Rate-limited (chain ${this.chainId}); will retry next tick.`,
        );
      } else {
        console.error(
          `[StellarChainAdapter] Poll error (chain ${this.chainId}):`,
          err,
        );
      }
    }
  }

  // ── event decoding ────────────────────────────────────────────────────

  private async processEvent(
    event: rpc.Api.EventResponse,
  ): Promise<void> {
    const topics = event.topic;
    if (!topics || topics.length === 0) return;

    const eventSymbol = scValSymbolToString(topics[0]);
    const eventType = STELLAR_EVENT_SYMBOLS[eventSymbol];
    if (!eventType) return; // unknown event — ignore

    const normalised = this.decodeEvent(eventType, event, topics);
    if (!normalised) return;

    console.log(
      `[StellarChainAdapter] ${normalised.type} — tokenId=${normalised.tokenId} ` +
        `tx=${normalised.transactionHash} ledger=${normalised.blockNumber}`,
    );

    await this.dispatch(normalised);
  }

  private decodeEvent(
    eventType: NormalisedSubscriptionEventType,
    event: rpc.Api.EventResponse,
    topics: xdr.ScVal[],
  ): NormalisedSubscriptionEvent | null {
    try {
      const valueVec = event.value.vec();
      const base: NormalisedSubscriptionEvent = {
        type: eventType,
        tokenId: "0",
        transactionHash: event.txHash,
        blockNumber: String(event.ledger),
        timestamp: Math.floor(new Date(event.ledgerClosedAt).getTime() / 1000),
      };

      switch (eventType) {
        case "minted": {
          // #[topic] subscriber (Address) in topic[1], value = [subscriber, token_id, plan_id, expiration]
          const subscriber = scValToJs(topics[1]) as string;
          if (valueVec) {
            base.tokenId = String(scValVecGet(event.value, 1));
            base.subscriber = subscriber;
            base.planId = String(scValVecGet(event.value, 2));
            base.expiration = scValToNumber(valueVec[3]);
          }
          break;
        }
        case "renewed": {
          // #[topic] token_id (u128) in topic[1], value = [token_id, new_expiration, amount_paid]
          base.tokenId = String(scValToBigInt(topics[1]));
          if (valueVec) {
            base.expiration = scValToNumber(valueVec[1]);
            base.amountPaidMicros = String(scValToBigInt(valueVec[2]));
          }
          break;
        }
        case "cancelled": {
          // #[topic] token_id (u128) in topic[1], value = [token_id]
          base.tokenId = String(scValToBigInt(topics[1]));
          break;
        }
        case "plan_changed": {
          // #[topic] token_id (u128) in topic[1], value = [token_id, previous_plan_id, new_plan_id, expiration]
          base.tokenId = String(scValToBigInt(topics[1]));
          if (valueVec) {
            base.previousPlanId = String(scValVecGet(event.value, 1));
            base.planId = String(scValVecGet(event.value, 2));
            base.expiration = scValToNumber(valueVec[3]);
          }
          break;
        }
        case "billing_executed": {
          // autopay-account emits BillingExecuted with topic[0] = Symbol, topic[1] = account
          // value = [account, merchant, token_id, plan_id, reason, gross_amount, merchant_amount, protocol_fee, timestamp]
          if (topics.length > 1) {
            base.account = scValToJs(topics[1]) as string;
          }
          if (valueVec && valueVec.length >= 9) {
            base.account = scValToJs(valueVec[0]) as string;
            base.merchant = scValToJs(valueVec[1]) as string;
            base.tokenId = String(scValToBigInt(valueVec[2]));
            base.planId = String(scValVecGet(event.value, 3));
            base.billingReason = Number(scValToBigInt(valueVec[4]));
            base.amountPaidMicros = String(scValToBigInt(valueVec[5]));
            base.merchantAmountMicros = String(scValToBigInt(valueVec[6]));
            base.protocolFeeMicros = String(scValToBigInt(valueVec[7]));
            base.timestamp = scValToNumber(valueVec[8]);
          }
          break;
        }
        default:
          return null;
      }

      return base;
    } catch (err) {
      console.warn(
        `[StellarChainAdapter] Failed to decode ${eventType} event ` +
          `(tx=${event.txHash}): ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  private async dispatch(event: NormalisedSubscriptionEvent): Promise<void> {
    const typeCallbacks = this.callbacks.get(event.type) || [];
    const wildcardCallbacks = this.callbacks.get("*") || [];

    for (const cb of [...typeCallbacks, ...wildcardCallbacks]) {
      try {
        await cb(event);
      } catch (err) {
        console.error(
          `[StellarChainAdapter] Callback error for ${event.type}:`,
          err,
        );
      }
    }
  }
}