// ============================================================
//  @arcenpay/node — Event Listener Service
//  Watches SubscriptionMinted, SubscriptionRenewed,
//  SubscriptionCancelled events from SubscriptionRegistry
// ============================================================

import { parseEventLogs } from "viem";
import { createResilientFacilitatorClient } from "../rpc-client.js";
import { sepolia, baseSepolia, base } from "viem/chains";
import {
  DEFAULT_CHAIN_ID,
  SubscriptionRegistryABI,
  getContractAddresses,
} from "@arcenpay/internal-core";

export type SubscriptionEventType =
  | "minted"
  | "renewed"
  | "cancelled"
  | "plan_changed"
  | "billing_executed";

export interface SubscriptionEventData {
  type: SubscriptionEventType;
  tokenId: bigint;
  subscriber?: string;
  planId?: bigint;
  previousPlanId?: bigint;
  expiration?: bigint;
  amountPaid?: bigint;
  account?: string;
  merchant?: string;
  billingReason?: bigint;
  merchantAmount?: bigint;
  protocolFee?: bigint;
  transactionHash: string;
  blockNumber: bigint;
  timestamp: number;
}

type EventCallback = (event: SubscriptionEventData) => void | Promise<void>;

const CHAIN_MAP: Record<number, any> = {
  11155111: sepolia,
  84532: baseSepolia,
  8453: base,
  5042002: baseSepolia, // Arc Testnet
};

/**
 * EventListenerService — Persistent event watchers for the SubscriptionRegistry.
 *
 * Watches for:
 *  - SubscriptionMinted(subscriber, tokenId, planId, expiration)
 *  - SubscriptionRenewed(tokenId, newExpiration, amountPaid)
 *  - SubscriptionCancelled(tokenId)
 *  - SubscriptionPlanChanged(tokenId, previousPlanId, newPlanId, expiration)
 *
 * PRD §9.1 — On-Chain Event Listeners
 */
export class EventListenerService {
  private publicClient: any;
  private registryAddress: string;
  private autopayModuleAddress: string;
  private callbacks: Map<SubscriptionEventType | "*", EventCallback[]> =
    new Map();
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private lastBlock: bigint = 0n;

  constructor(config: {
    rpcUrl: string;
    chainId?: number;
    registryAddress?: string;
  }) {
    const chainId = config.chainId ?? DEFAULT_CHAIN_ID;
    const chain = CHAIN_MAP[chainId] || baseSepolia;
    const contracts = getContractAddresses(chainId);
    this.registryAddress =
      config.registryAddress || contracts.subscriptionRegistry;
    this.autopayModuleAddress = contracts.autopayModule;

    this.publicClient = createResilientFacilitatorClient(config.rpcUrl, chainId) as any;
  }

  /**
   * Register a callback for a specific event type (or '*' for all events)
   */
  on(
    eventType: SubscriptionEventType | "*",
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

  /**
   * Start polling for events at the given interval
   */
  async start(intervalMs = 15000): Promise<void> {
    try {
      this.lastBlock = await this.publicClient.getBlockNumber();
    } catch {
      this.lastBlock = 0n;
    }

    console.log(
      `[EventListener] Watching SubscriptionRegistry at ${this.registryAddress} from block ${this.lastBlock}`,
    );

    this.pollInterval = setInterval(async () => {
      await this.poll();
    }, intervalMs);
  }

  /**
   * Stop polling
   */
  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    console.log("[EventListener] Stopped");
  }

  /**
   * Poll for new events since lastBlock
   */
  private async poll(): Promise<void> {
    try {
      const currentBlock = await this.publicClient.getBlockNumber();
      if (currentBlock <= this.lastBlock) return;
      const addr = this.registryAddress as `0x${string}`;
      const from = this.lastBlock + 1n;

      // Single log query for SubscriptionRegistry events + 1 query for BillingExecuted
      const [registryLogs, billingLogs] = await Promise.all([
        this.publicClient.getLogs({
          address: addr,
          fromBlock: from,
          toBlock: currentBlock,
        }).catch(() => []),
        this.publicClient.getLogs({
          address: this.autopayModuleAddress as `0x${string}`,
          event: {
            type: "event",
            name: "BillingExecuted",
            inputs: [
              { name: "account", type: "address", indexed: true },
              { name: "merchant", type: "address", indexed: true },
              { name: "tokenId", type: "uint256", indexed: true },
              { name: "planId", type: "uint256", indexed: false },
              { name: "reason", type: "uint8", indexed: false },
              { name: "grossAmount", type: "uint256", indexed: false },
              { name: "merchantAmount", type: "uint256", indexed: false },
              { name: "protocolFee", type: "uint256", indexed: false },
              { name: "timestamp", type: "uint256", indexed: false },
            ],
          },
          fromBlock: from,
          toBlock: currentBlock,
        }).catch(() => []),
      ]);

      const parsedRegistryLogs = parseEventLogs({
        abi: SubscriptionRegistryABI,
        logs: registryLogs,
      });

      for (const log of parsedRegistryLogs) {
        if (log.eventName === "SubscriptionMinted") {
          await this.emit({
            type: "minted",
            tokenId: (log.args as any).tokenId,
            subscriber: (log.args as any).subscriber,
            planId: (log.args as any).planId,
            expiration: (log.args as any).expiration,
            transactionHash: log.transactionHash,
            blockNumber: log.blockNumber,
            timestamp: Date.now(),
          });
        } else if (log.eventName === "SubscriptionRenewed") {
          await this.emit({
            type: "renewed",
            tokenId: (log.args as any).tokenId,
            expiration: (log.args as any).newExpiration,
            amountPaid: (log.args as any).amountPaid,
            transactionHash: log.transactionHash,
            blockNumber: log.blockNumber,
            timestamp: Date.now(),
          });
        } else if (log.eventName === "SubscriptionCancelled") {
          await this.emit({
            type: "cancelled",
            tokenId: (log.args as any).tokenId,
            transactionHash: log.transactionHash,
            blockNumber: log.blockNumber,
            timestamp: Date.now(),
          });
        } else if (log.eventName === "SubscriptionPlanChanged") {
          await this.emit({
            type: "plan_changed",
            tokenId: (log.args as any).tokenId,
            previousPlanId: (log.args as any).previousPlanId,
            planId: (log.args as any).newPlanId,
            expiration: (log.args as any).expiration,
            transactionHash: log.transactionHash,
            blockNumber: log.blockNumber,
            timestamp: Date.now(),
          });
        }
      }

      for (const log of billingLogs) {
        await this.emit({
          type: "billing_executed",
          tokenId: (log as any).args.tokenId,
          account: (log as any).args.account,
          merchant: (log as any).args.merchant,
          planId: (log as any).args.planId,
          billingReason: (log as any).args.reason,
          amountPaid: (log as any).args.grossAmount,
          merchantAmount: (log as any).args.merchantAmount,
          protocolFee: (log as any).args.protocolFee,
          transactionHash: log.transactionHash,
          blockNumber: log.blockNumber,
          timestamp: Number((log as any).args.timestamp ?? Date.now()),
        });
      }

      this.lastBlock = currentBlock;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("request limit reached") || msg.includes("429") || msg.includes("-32011")) {
        console.warn("[EventListener] RPC rate limit encountered. Will retry next tick.");
      } else {
        console.error("[EventListener] Polling error:", err);
      }
    }
  }

  /**
   * Dispatch event to registered callbacks
   */
  private async emit(event: SubscriptionEventData): Promise<void> {
    console.log(
      `[EventListener] ${event.type} — tokenId=${event.tokenId} tx=${event.transactionHash}`,
    );

    const typeCallbacks = this.callbacks.get(event.type) || [];
    const wildcardCallbacks = this.callbacks.get("*") || [];

    for (const cb of [...typeCallbacks, ...wildcardCallbacks]) {
      try {
        await cb(event);
      } catch (err) {
        console.error(`[EventListener] Callback error for ${event.type}:`, err);
      }
    }
  }
}
