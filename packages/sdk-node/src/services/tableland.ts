// ============================================================
//  @meap/node — Tableland Feature Flags Service
//  CRUD operations for feature flags stored in Tableland
//  PRD §3.1.2 — Decentralized Entitlement Store
// ============================================================

import type { FeatureFlag, PlanTier, TablelandEntitlement } from '@meap/core';

export interface TablelandConfig {
    /** Tableland table name (e.g., 'meap_feature_flags_84532_123') */
    tableName: string;
    /** Private key for Tableland controller wallet */
    privateKey: string;
    /** Chain ID for Tableland network */
    chainId: number;
    /** Gateway URL override (default: Tableland validator) */
    gatewayUrl?: string;
}

/**
 * TablelandService — Feature flag CRUD via Tableland decentralized database.
 *
 * Table schema (PRD §3.1.2):
 *   wallet_address TEXT PRIMARY KEY,
 *   nft_token_id INTEGER,
 *   plan_tier TEXT,
 *   feature_flags TEXT (JSON),
 *   api_rate_limit INTEGER,
 *   billing_interval INTEGER,
 *   last_renewed INTEGER,
 *   expires_at INTEGER,
 *   chain_id INTEGER
 *
 * Requires: @tableland/sdk (install when ready for production)
 */
export class TablelandService {
    private config: TablelandConfig;
    private initialized = false;

    constructor(config: TablelandConfig) {
        this.config = config;
    }

    /**
     * Initialize Tableland connection and create table if needed
     */
    async initialize(): Promise<void> {
        // TODO: Replace with actual @tableland/sdk initialization
        //
        // import { Database } from '@tableland/sdk';
        // import { Wallet, getDefaultProvider } from 'ethers';
        //
        // const signer = new Wallet(this.config.privateKey);
        // this.db = new Database({ signer });
        //
        // Create table if not exists:
        //   CREATE TABLE IF NOT EXISTS ${prefix} (
        //     wallet_address TEXT PRIMARY KEY,
        //     nft_token_id INTEGER,
        //     plan_tier TEXT,
        //     feature_flags TEXT,
        //     api_rate_limit INTEGER DEFAULT 1000,
        //     billing_interval INTEGER,
        //     last_renewed INTEGER,
        //     expires_at INTEGER,
        //     chain_id INTEGER
        //   )

        this.initialized = true;
        console.log(`[Tableland] Initialized table: ${this.config.tableName}`);
    }

    /**
     * Get feature flags for a wallet
     */
    async getFeatureFlags(walletAddress: string): Promise<FeatureFlag[]> {
        this.ensureInitialized();

        try {
            const gatewayUrl = this.config.gatewayUrl || 'https://tableland.network/api/v1/query';
            const response = await fetch(
                `${gatewayUrl}?statement=SELECT feature_flags, plan_tier FROM ${this.config.tableName} WHERE wallet_address='${walletAddress.toLowerCase()}'`
            );

            if (!response.ok) {
                console.warn('[Tableland] Query failed:', await response.text());
                return [];
            }

            const rows = await response.json() as any[];
            if (!rows.length) return [];

            const row = rows[0];
            const flags = JSON.parse(row.feature_flags || '{}');
            const tier = row.plan_tier;

            return Object.entries(flags).map(([key, value]) => ({
                key,
                value: value as boolean | string | number,
                planTier: tier,
            }));
        } catch (err) {
            console.error('[Tableland] Read error:', err);
            return [];
        }
    }

    /**
     * Set feature flags for a wallet (upsert)
     */
    async setFeatureFlags(
        walletAddress: string,
        flags: Record<string, boolean | string | number>,
        metadata: Partial<TablelandEntitlement>,
    ): Promise<boolean> {
        this.ensureInitialized();

        try {
            // TODO: Replace with actual @tableland/sdk write
            //
            // const { meta } = await this.db
            //   .prepare(`INSERT INTO ${this.config.tableName}
            //     (wallet_address, nft_token_id, plan_tier, feature_flags,
            //      api_rate_limit, billing_interval, last_renewed, expires_at, chain_id)
            //     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            //     ON CONFLICT (wallet_address) DO UPDATE SET
            //       feature_flags = excluded.feature_flags,
            //       plan_tier = excluded.plan_tier,
            //       expires_at = excluded.expires_at,
            //       last_renewed = excluded.last_renewed`)
            //   .bind(
            //     walletAddress.toLowerCase(),
            //     metadata.nft_token_id || 0,
            //     metadata.plan_tier || 'starter',
            //     JSON.stringify(flags),
            //     metadata.api_rate_limit || 1000,
            //     metadata.billing_interval || 2592000,
            //     metadata.last_renewed || Math.floor(Date.now() / 1000),
            //     metadata.expires_at || 0,
            //     this.config.chainId,
            //   )
            //   .run();

            console.log(`[Tableland] Updated flags for ${walletAddress}: ${JSON.stringify(flags)}`);
            return true;
        } catch (err) {
            console.error('[Tableland] Write error:', err);
            return false;
        }
    }

    /**
     * Delete entitlement entry (on cancellation)
     */
    async revokeEntitlement(walletAddress: string): Promise<boolean> {
        this.ensureInitialized();

        try {
            // TODO: Replace with actual @tableland/sdk write
            // await this.db.prepare(`DELETE FROM ${this.config.tableName} WHERE wallet_address=?`)
            //   .bind(walletAddress.toLowerCase())
            //   .run();

            console.log(`[Tableland] Revoked entitlement for ${walletAddress}`);
            return true;
        } catch (err) {
            console.error('[Tableland] Delete error:', err);
            return false;
        }
    }

    /**
     * Get all entitlements (for dashboard display)
     */
    async listEntitlements(limit = 100): Promise<TablelandEntitlement[]> {
        this.ensureInitialized();

        try {
            const gatewayUrl = this.config.gatewayUrl || 'https://tableland.network/api/v1/query';
            const response = await fetch(
                `${gatewayUrl}?statement=SELECT * FROM ${this.config.tableName} LIMIT ${limit}`
            );

            if (!response.ok) return [];
            return (await response.json()) as TablelandEntitlement[];
        } catch {
            return [];
        }
    }

    /**
     * Sync on-chain subscription state to Tableland
     * Called by EventListenerService on Minted/Renewed events
     */
    async syncSubscription(data: {
        walletAddress: string;
        tokenId: number;
        planTier: PlanTier;
        expiresAt: number;
        billingInterval: number;
        features: Record<string, boolean | string | number>;
    }): Promise<void> {
        await this.setFeatureFlags(data.walletAddress, data.features, {
            wallet_address: data.walletAddress,
            nft_token_id: data.tokenId,
            plan_tier: data.planTier,
            expires_at: data.expiresAt,
            billing_interval: data.billingInterval,
            last_renewed: Math.floor(Date.now() / 1000),
            chain_id: this.config.chainId,
            api_rate_limit: data.planTier === 'enterprise' ? 10000 : data.planTier === 'pro' ? 5000 : 1000,
            feature_flags: data.features,
        });
    }

    private ensureInitialized(): void {
        if (!this.initialized) {
            throw new Error('[Tableland] Service not initialized. Call initialize() first.');
        }
    }
}
