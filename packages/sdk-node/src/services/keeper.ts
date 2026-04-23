// ============================================================
//  @arcenpay/node — Billing Automation Keeper
//  Polls for expired subscriptions and triggers automated
//  renewal via ERC-7579 AutopayModule.execute()
//  PRD MEAP-004 — Automated Renewal Execution
// ============================================================

import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia, baseSepolia, base } from "viem/chains";
import {
    DEFAULT_CHAIN_ID,
    SubscriptionRegistryABI,
    ERC7579AutopayModuleABI,
    PlanFactoryABI,
    getContractAddresses,
} from "@arcenpay/sdk";

const CHAIN_MAP: Record<number, any> = {
    11155111: sepolia,
    84532: baseSepolia,
    8453: base,
};

export interface BillingKeeperConfig {
    /** RPC URL for the chain */
    rpcUrl: string;
    /** Chain ID */
    chainId?: number;
    /** Private key for the keeper signer (pays gas for execute calls) */
    privateKey: `0x${string}`;
    /** Polling interval in ms (default: 60000 = 1 minute) */
    intervalMs?: number;
    /** Max subscriptions to process per batch (default: 20) */
    batchSize?: number;
    /** How many seconds before expiry to trigger renewal (default: 86400 = 1 day) */
    renewalBufferSeconds?: number;
}

interface RenewalResult {
    tokenId: bigint;
    subscriber: string;
    txHash: `0x${string}`;
    success: boolean;
    error?: string;
}

/**
 * BillingKeeper — Automated subscription renewal service.
 *
 * Polls SubscriptionRegistry for subscriptions nearing expiry,
 * then calls ERC7579AutopayModule.execute() to pull the renewal
 * payment from the subscriber's smart account.
 *
 * Architecture:
 *   1. Poll registry for subscriptions expiring within `renewalBufferSeconds`
 *   2. For each, check that the subscriber has an installed AutopayModule
 *   3. Call execute() on the module to trigger the payment pull
 *   4. Log results and emit renewal events
 *
 * PRD MEAP-004 — Automated Renewal Execution
 */
export class BillingKeeper {
    private readonly chainId: number;
    private readonly publicClient: any;
    private readonly walletClient: any;
    private readonly signerAddress: `0x${string}`;
    private readonly intervalMs: number;
    private readonly batchSize: number;
    private readonly renewalBufferSeconds: number;
    private readonly registryAddress: `0x${string}`;
    private readonly autopayModuleAddress: `0x${string}`;
    private pollTimer: ReturnType<typeof setInterval> | null = null;
    private processing = false;
    private renewalLog: RenewalResult[] = [];
    private callbacks: Array<(result: RenewalResult) => void> = [];

    constructor(config: BillingKeeperConfig) {
        this.chainId = config.chainId ?? DEFAULT_CHAIN_ID;
        const chain = CHAIN_MAP[this.chainId] || baseSepolia;
        const contracts = getContractAddresses(this.chainId);

        this.registryAddress = contracts.subscriptionRegistry as `0x${string}`;
        this.autopayModuleAddress = contracts.autopayModule as `0x${string}`;
        this.intervalMs = config.intervalMs || 60_000;
        this.batchSize = config.batchSize || 20;
        this.renewalBufferSeconds = config.renewalBufferSeconds || 86_400;

        const account = privateKeyToAccount(config.privateKey);
        this.signerAddress = account.address;

        this.publicClient = createPublicClient({
            chain,
            transport: http(config.rpcUrl),
        }) as any;

        this.walletClient = createWalletClient({
            account,
            chain,
            transport: http(config.rpcUrl),
        }) as any;
    }

    /**
     * Register a callback for renewal events
     */
    onRenewal(callback: (result: RenewalResult) => void): () => void {
        this.callbacks.push(callback);
        return () => {
            this.callbacks = this.callbacks.filter((cb) => cb !== callback);
        };
    }

    /**
     * Start the keeper polling loop
     */
    start(): void {
        if (this.pollTimer) return;

        console.log(
            `[BillingKeeper] Started — polling every ${this.intervalMs / 1000}s, ` +
            `renewal buffer ${this.renewalBufferSeconds}s, batch size ${this.batchSize}`,
        );

        // Run immediately, then poll
        void this.poll();
        this.pollTimer = setInterval(() => {
            void this.poll();
        }, this.intervalMs);
    }

    /**
     * Stop the keeper
     */
    stop(): void {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
        console.log("[BillingKeeper] Stopped");
    }

    /**
     * Get renewal history
     */
    getRenewalLog(limit = 50): RenewalResult[] {
        return this.renewalLog.slice(-limit).reverse();
    }

    /**
     * Get keeper stats
     */
    getStats(): {
        running: boolean;
        totalRenewals: number;
        successfulRenewals: number;
        failedRenewals: number;
    } {
        const successful = this.renewalLog.filter((r) => r.success).length;
        return {
            running: this.pollTimer !== null,
            totalRenewals: this.renewalLog.length,
            successfulRenewals: successful,
            failedRenewals: this.renewalLog.length - successful,
        };
    }

    /**
     * Poll for subscriptions needing renewal
     */
    private async poll(): Promise<void> {
        if (this.processing) return;
        this.processing = true;

        try {
            const now = Math.floor(Date.now() / 1000);
            const renewalDeadline = now + this.renewalBufferSeconds;

            // Query for subscriptions that are expiring soon
            // The registry's expiresAt() function returns the expiry timestamp
            // We need to scan through known token IDs — in production this would
            // come from The Graph subgraph. For now, use event logs.
            const expiringTokenIds = await this.findExpiringSubscriptions(
                BigInt(now),
                BigInt(renewalDeadline),
            );

            if (expiringTokenIds.length === 0) {
                this.processing = false;
                return;
            }

            console.log(
                `[BillingKeeper] Found ${expiringTokenIds.length} subscriptions nearing expiry`,
            );

            // Process in batches
            const batch = expiringTokenIds.slice(0, this.batchSize);
            for (const tokenId of batch) {
                await this.processRenewal(tokenId);
            }
        } catch (err) {
            console.error("[BillingKeeper] Poll error:", err);
        } finally {
            this.processing = false;
        }
    }

    /**
     * Find subscriptions expiring between now and the renewal deadline
     */
    private async findExpiringSubscriptions(
        now: bigint,
        deadline: bigint,
    ): Promise<bigint[]> {
        try {
            // Look for recent SubscriptionMinted + SubscriptionRenewed events
            // to build a list of active token IDs, then check expiry
            const currentBlock = await this.publicClient.getBlockNumber();
            const fromBlock =
                currentBlock > 50000n ? currentBlock - 50000n : 0n;

            const mintedLogs = await this.publicClient.getLogs({
                address: this.registryAddress,
                event: {
                    type: "event" as const,
                    name: "SubscriptionMinted",
                    inputs: [
                        { name: "subscriber", type: "address", indexed: true },
                        { name: "tokenId", type: "uint256", indexed: true },
                        { name: "planId", type: "uint256", indexed: true },
                        { name: "expiration", type: "uint64", indexed: false },
                    ],
                },
                fromBlock,
                toBlock: currentBlock,
            });

            const tokenIds: bigint[] = [];
            for (const log of mintedLogs) {
                const tokenId = (log as any).args.tokenId as bigint;

                try {
                    const expiresAt = (await this.publicClient.readContract({
                        address: this.registryAddress,
                        abi: SubscriptionRegistryABI,
                        functionName: "expiresAt",
                        args: [tokenId],
                    })) as bigint;

                    // Check if expiry is within the renewal window
                    if (expiresAt > now && expiresAt <= deadline) {
                        tokenIds.push(tokenId);
                    }
                } catch {
                    // Token might not exist anymore
                }
            }

            return tokenIds;
        } catch (err) {
            console.error("[BillingKeeper] Error finding expiring subscriptions:", err);
            return [];
        }
    }

    /**
     * Process a single subscription renewal
     */
    private async processRenewal(tokenId: bigint): Promise<void> {
        try {
            // Get the subscriber address from the token
            const subscriber = (await this.publicClient.readContract({
                address: this.registryAddress,
                abi: SubscriptionRegistryABI,
                functionName: "ownerOf",
                args: [tokenId],
            })) as `0x${string}`;

            // Check if AutopayModule is installed for this subscriber
            const isInstalled = await this.checkAutopayInstalled(subscriber);
            if (!isInstalled) {
                console.log(
                    `[BillingKeeper] Skipping tokenId=${tokenId} — no AutopayModule installed`,
                );
                return;
            }

            const config = (await this.publicClient.readContract({
                address: this.autopayModuleAddress,
                abi: ERC7579AutopayModuleABI,
                functionName: "getConfig",
                args: [subscriber],
            })) as any;

            const merchant = String(config?.merchant ?? config?.[0] ?? "").toLowerCase();
            const amount = BigInt(config?.maxAmount ?? config?.[1] ?? 0);

            if (amount <= 0n) {
                console.log(
                    `[BillingKeeper] Skipping tokenId=${tokenId} — autopay maxAmount is not configured`,
                );
                return;
            }

            if (merchant !== this.signerAddress.toLowerCase()) {
                throw new Error(
                    `Keeper signer ${this.signerAddress} does not match autopay merchant ${merchant || "unknown"}. ` +
                    "Renewals must be executed by the configured merchant wallet.",
                );
            }

            // Execute the renewal payment
            const txHash = (await this.walletClient.writeContract({
                address: this.autopayModuleAddress,
                abi: ERC7579AutopayModuleABI,
                functionName: "execute",
                args: [subscriber, amount],
            })) as `0x${string}`;

            await this.publicClient.waitForTransactionReceipt({ hash: txHash });

            const result: RenewalResult = {
                tokenId,
                subscriber,
                txHash,
                success: true,
            };

            this.logRenewal(result);
            console.log(
                `[BillingKeeper] ✅ Renewed tokenId=${tokenId} for ${subscriber} — tx: ${txHash}`,
            );
        } catch (err: any) {
            const result: RenewalResult = {
                tokenId,
                subscriber: "unknown",
                txHash: "0x" as `0x${string}`,
                success: false,
                error: err?.message || String(err),
            };

            this.logRenewal(result);
            console.error(
                `[BillingKeeper] ❌ Failed to renew tokenId=${tokenId}:`,
                err?.message,
            );
        }
    }

    /**
     * Check if AutopayModule is installed for a subscriber
     */
    private async checkAutopayInstalled(
        subscriber: `0x${string}`,
    ): Promise<boolean> {
        try {
            const config = (await this.publicClient.readContract({
                address: this.autopayModuleAddress,
                abi: ERC7579AutopayModuleABI,
                functionName: "getConfig",
                args: [subscriber],
            })) as any;

            // If maxAmount > 0, the module is installed and configured
            const maxAmount = BigInt(config?.maxAmount ?? config?.[0] ?? 0);
            return maxAmount > 0n;
        } catch {
            return false;
        }
    }

    /**
     * Log a renewal result
     */
    private logRenewal(result: RenewalResult): void {
        this.renewalLog.push(result);
        if (this.renewalLog.length > 1000) {
            this.renewalLog = this.renewalLog.slice(-500);
        }

        for (const cb of this.callbacks) {
            try {
                cb(result);
            } catch (err) {
                console.error("[BillingKeeper] Callback error:", err);
            }
        }
    }
}
