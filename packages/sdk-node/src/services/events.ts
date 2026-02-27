// ============================================================
//  @meap/node — Event Listener Service
//  Watches SubscriptionMinted, SubscriptionRenewed,
//  SubscriptionCancelled events from SubscriptionRegistry
// ============================================================

import { createPublicClient, http, type Log } from 'viem';
import { sepolia, baseSepolia, base } from 'viem/chains';
import { SubscriptionRegistryABI, getContractAddresses } from '@meap/core';

export type SubscriptionEventType = 'minted' | 'renewed' | 'cancelled';

export interface SubscriptionEventData {
    type: SubscriptionEventType;
    tokenId: bigint;
    subscriber?: string;
    planId?: bigint;
    expiration?: bigint;
    amountPaid?: bigint;
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
 *
 * PRD §9.1 — On-Chain Event Listeners
 */
export class EventListenerService {
    private publicClient: any;
    private registryAddress: string;
    private callbacks: Map<SubscriptionEventType | '*', EventCallback[]> = new Map();
    private pollInterval: ReturnType<typeof setInterval> | null = null;
    private lastBlock: bigint = 0n;

    constructor(config: {
        rpcUrl: string;
        chainId?: number;
        registryAddress?: string;
    }) {
        const chainId = config.chainId || 11155111;
        const chain = CHAIN_MAP[chainId] || sepolia;
        const contracts = getContractAddresses(chainId);
        this.registryAddress = config.registryAddress || contracts.subscriptionRegistry;

        this.publicClient = createPublicClient({
            chain,
            transport: http(config.rpcUrl),
        }) as any;
    }

    /**
     * Register a callback for a specific event type (or '*' for all events)
     */
    on(eventType: SubscriptionEventType | '*', callback: EventCallback): () => void {
        const existing = this.callbacks.get(eventType) || [];
        existing.push(callback);
        this.callbacks.set(eventType, existing);

        return () => {
            const cbs = this.callbacks.get(eventType) || [];
            this.callbacks.set(eventType, cbs.filter((cb) => cb !== callback));
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

        console.log(`[EventListener] Watching SubscriptionRegistry at ${this.registryAddress} from block ${this.lastBlock}`);

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
        console.log('[EventListener] Stopped');
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

            // Fetch all 3 event types in parallel
            const [mintedLogs, renewedLogs, cancelledLogs] = await Promise.all([
                this.publicClient.getLogs({
                    address: addr,
                    event: {
                        type: 'event',
                        name: 'SubscriptionMinted',
                        inputs: [
                            { name: 'subscriber', type: 'address', indexed: true },
                            { name: 'tokenId', type: 'uint256', indexed: true },
                            { name: 'planId', type: 'uint256', indexed: true },
                            { name: 'expiration', type: 'uint64', indexed: false },
                        ],
                    },
                    fromBlock: from,
                    toBlock: currentBlock,
                }),
                this.publicClient.getLogs({
                    address: addr,
                    event: {
                        type: 'event',
                        name: 'SubscriptionRenewed',
                        inputs: [
                            { name: 'tokenId', type: 'uint256', indexed: true },
                            { name: 'newExpiration', type: 'uint64', indexed: false },
                            { name: 'amountPaid', type: 'uint256', indexed: false },
                        ],
                    },
                    fromBlock: from,
                    toBlock: currentBlock,
                }),
                this.publicClient.getLogs({
                    address: addr,
                    event: {
                        type: 'event',
                        name: 'SubscriptionCancelled',
                        inputs: [
                            { name: 'tokenId', type: 'uint256', indexed: true },
                        ],
                    },
                    fromBlock: from,
                    toBlock: currentBlock,
                }),
            ]);

            // Process minted events
            for (const log of mintedLogs) {
                await this.emit({
                    type: 'minted',
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
                    type: 'renewed',
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
                    type: 'cancelled',
                    tokenId: (log as any).args.tokenId,
                    transactionHash: log.transactionHash,
                    blockNumber: log.blockNumber,
                    timestamp: Date.now(),
                });
            }

            this.lastBlock = currentBlock;
        } catch (err) {
            console.error('[EventListener] Polling error:', err);
        }
    }

    /**
     * Dispatch event to registered callbacks
     */
    private async emit(event: SubscriptionEventData): Promise<void> {
        console.log(`[EventListener] ${event.type} — tokenId=${event.tokenId} tx=${event.transactionHash}`);

        const typeCallbacks = this.callbacks.get(event.type) || [];
        const wildcardCallbacks = this.callbacks.get('*') || [];

        for (const cb of [...typeCallbacks, ...wildcardCallbacks]) {
            try {
                await cb(event);
            } catch (err) {
                console.error(`[EventListener] Callback error for ${event.type}:`, err);
            }
        }
    }
}
