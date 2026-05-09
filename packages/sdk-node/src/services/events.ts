// ============================================================
//  @arcenpay/node — Event Listener Service
//  Watches SubscriptionMinted, SubscriptionRenewed,
//  SubscriptionCancelled events from SubscriptionRegistry
// ============================================================

import { createPublicClient, http } from "viem";
import { sepolia, baseSepolia, base } from "viem/chains";
import { DEFAULT_CHAIN_ID, getContractAddresses } from "../sdk";

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

    this.publicClient = createPublicClient({
      chain,
      transport: http(config.rpcUrl),
    }) as any;
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
  async start(intervalMs = 12000): Promise<void> {
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

      // Fetch all subscription lifecycle event types in parallel
      const [
        mintedLogs,
        renewedLogs,
        cancelledLogs,
        planChangedLogs,
        billingLogs,
      ] = await Promise.all([
        this.publicClient.getLogs({
          address: addr,
          event: {
            type: "event",
            name: "SubscriptionMinted",
            inputs: [
              { name: "subscriber", type: "address", indexed: true },
              { name: "tokenId", type: "uint256", indexed: true },
              { name: "planId", type: "uint256", indexed: true },
              { name: "expiration", type: "uint64", indexed: false },
            ],
          },
          fromBlock: from,
          toBlock: currentBlock,
        }),
        this.publicClient.getLogs({
          address: addr,
          event: {
            type: "event",
            name: "SubscriptionRenewed",
            inputs: [
              { name: "tokenId", type: "uint256", indexed: true },
              { name: "newExpiration", type: "uint64", indexed: false },
              { name: "amountPaid", type: "uint256", indexed: false },
            ],
          },
          fromBlock: from,
          toBlock: currentBlock,
        }),
        this.publicClient.getLogs({
          address: addr,
          event: {
            type: "event",
            name: "SubscriptionCancelled",
            inputs: [{ name: "tokenId", type: "uint256", indexed: true }],
          },
          fromBlock: from,
          toBlock: currentBlock,
        }),
        this.publicClient.getLogs({
          address: addr,
          event: {
            type: "event",
            name: "SubscriptionPlanChanged",
            inputs: [
              { name: "tokenId", type: "uint256", indexed: true },
              { name: "previousPlanId", type: "uint256", indexed: true },
              { name: "newPlanId", type: "uint256", indexed: true },
              { name: "expiration", type: "uint64", indexed: false },
            ],
          },
          fromBlock: from,
          toBlock: currentBlock,
        }),
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
        }),
      ]);

      // Process minted events
      for (const log of mintedLogs) {
        await this.emit({
          type: "minted",
          tokenId: (log as any).args.tokenId,
          subscriber: (log as any).args.subscriber,
          planId: (log as any).args.planId,
          expiration: (log as any).args.expiration,
          transactionHash: log.transactionHash,
          blockNumber: log.blockNumber,
          timestamp: Date.now(),
        });
      }

      // Process renewed events
      for (const log of renewedLogs) {
        await this.emit({
          type: "renewed",
          tokenId: (log as any).args.tokenId,
          expiration: (log as any).args.newExpiration,
          amountPaid: (log as any).args.amountPaid,
          transactionHash: log.transactionHash,
          blockNumber: log.blockNumber,
          timestamp: Date.now(),
        });
      }

      // Process cancelled events
      for (const log of cancelledLogs) {
        await this.emit({
          type: "cancelled",
          tokenId: (log as any).args.tokenId,
          transactionHash: log.transactionHash,
          blockNumber: log.blockNumber,
          timestamp: Date.now(),
        });
      }

      // Process plan-changed events
      for (const log of planChangedLogs) {
        await this.emit({
          type: "plan_changed",
          tokenId: (log as any).args.tokenId,
          planId: (log as any).args.newPlanId,
          previousPlanId: (log as any).args.previousPlanId,
          expiration: (log as any).args.expiration,
          transactionHash: log.transactionHash,
          blockNumber: log.blockNumber,
          timestamp: Date.now(),
        });
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
    } catch (err) {
      console.error("[EventListener] Polling error:", err);
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
