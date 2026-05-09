// ============================================================
//  @arcenpay/node — Tableland Feature Flags Service
//  CRUD operations for feature flags stored in Tableland
// ============================================================

import { Database } from "@tableland/sdk";
import type { PlanTier, TablelandEntitlement } from "../sdk";
// Tableland SDK requires a full ethers Signer — ethers is an explicit dependency.
// Viem is used everywhere else; this is the one place ethers is intentional.
import { JsonRpcProvider, Wallet } from "ethers";

export interface TablelandConfig {
  /** Tableland table name (e.g., meap_feature_flags_84532_123) */
  tableName: string;
  /** Tableland controller wallet private key (required for writes) */
  privateKey?: string;
  /** Chain ID used for metadata and defaults */
  chainId: number;
  /** RPC URL for signer/provider connectivity */
  rpcUrl?: string;
  /** Gateway URL override (used for read HTTP fallback paths) */
  gatewayUrl?: string;
}

type TierFlagsMatrix = Record<
  string,
  Record<string, boolean | string | number>
>;

export class TablelandService {
  private config: TablelandConfig;
  private initialized = false;
  private dbRead: Database | null = null;
  private dbWrite: Database | null = null;

  constructor(config: TablelandConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    this.ensureSafeTableName();
    this.dbRead = new Database({
      ...(this.config.gatewayUrl ? { baseUrl: this.config.gatewayUrl } : {}),
    });

    if (this.config.privateKey && this.config.rpcUrl) {
      // Tableland SDK is built on ethers and requires a real ethers Signer.
      // ethers is an explicit peer in package.json — this usage is intentional.
      const provider = new JsonRpcProvider(this.config.rpcUrl);
      const signer = new Wallet(this.config.privateKey, provider);
      this.dbWrite = new Database({
        signer,
        ...(this.config.gatewayUrl ? { baseUrl: this.config.gatewayUrl } : {}),
      });
    }

    this.initialized = true;
    console.log(
      `[Tableland] Initialized table=${this.config.tableName} mode=${this.dbWrite ? "read-write" : "read-only"}`,
    );
  }

  async getFeatureFlags(
    walletAddress: string,
  ): Promise<Record<string, boolean | string | number>> {
    this.ensureInitialized();
    const normalized = walletAddress.toLowerCase();

    try {
      const statement = `SELECT feature_flags FROM ${this.config.tableName} WHERE wallet_address = ? LIMIT 1`;
      const response = await this.dbRead!.prepare(statement)
        .bind(normalized)
        .all();
      const row = (response.results as Array<{ feature_flags?: string }>)[0];
      if (!row?.feature_flags) return {};
      const parsed = JSON.parse(row.feature_flags) as Record<
        string,
        boolean | string | number
      >;
      return parsed ?? {};
    } catch (err) {
      console.error("[Tableland] getFeatureFlags error:", err);
      return {};
    }
  }

  async setFeatureFlags(
    walletAddress: string,
    flags: Record<string, boolean | string | number>,
    metadata: Partial<TablelandEntitlement>,
  ): Promise<boolean> {
    this.ensureInitialized();
    this.ensureWritable();
    const normalized = walletAddress.toLowerCase();

    const now = Math.floor(Date.now() / 1000);
    const nftTokenId = metadata.nft_token_id ?? 0;
    const planTier = metadata.plan_tier ?? "starter";
    const apiRateLimit =
      metadata.api_rate_limit ?? this.defaultRateLimitForTier(planTier);
    const billingInterval = metadata.billing_interval ?? 2_592_000;
    const lastRenewed = metadata.last_renewed ?? now;
    const expiresAt = metadata.expires_at ?? 0;
    const chainId = metadata.chain_id ?? this.config.chainId;

    try {
      const statement = `
        INSERT INTO ${this.config.tableName}
        (wallet_address, nft_token_id, plan_tier, feature_flags, api_rate_limit, billing_interval, last_renewed, expires_at, chain_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (wallet_address) DO UPDATE SET
          nft_token_id = excluded.nft_token_id,
          plan_tier = excluded.plan_tier,
          feature_flags = excluded.feature_flags,
          api_rate_limit = excluded.api_rate_limit,
          billing_interval = excluded.billing_interval,
          last_renewed = excluded.last_renewed,
          expires_at = excluded.expires_at,
          chain_id = excluded.chain_id
      `;

      await this.dbWrite!.prepare(statement)
        .bind(
          normalized,
          nftTokenId,
          planTier,
          JSON.stringify(flags),
          apiRateLimit,
          billingInterval,
          lastRenewed,
          expiresAt,
          chainId,
        )
        .run();

      return true;
    } catch (err) {
      console.error("[Tableland] setFeatureFlags error:", err);
      return false;
    }
  }

  async revokeEntitlement(walletAddress: string): Promise<boolean> {
    this.ensureInitialized();
    this.ensureWritable();

    try {
      const statement = `DELETE FROM ${this.config.tableName} WHERE wallet_address = ?`;
      await this.dbWrite!.prepare(statement)
        .bind(walletAddress.toLowerCase())
        .run();
      return true;
    } catch (err) {
      console.error("[Tableland] revokeEntitlement error:", err);
      return false;
    }
  }

  async revokeEntitlementByTokenId(tokenId: number): Promise<boolean> {
    this.ensureInitialized();
    this.ensureWritable();

    try {
      const statement = `DELETE FROM ${this.config.tableName} WHERE nft_token_id = ?`;
      await this.dbWrite!.prepare(statement).bind(tokenId).run();
      return true;
    } catch (err) {
      console.error("[Tableland] revokeEntitlementByTokenId error:", err);
      return false;
    }
  }

  async updateEntitlementByTokenId(
    tokenId: number,
    updates: Partial<
      Pick<
        TablelandEntitlement,
        | "feature_flags"
        | "plan_tier"
        | "expires_at"
        | "last_renewed"
        | "api_rate_limit"
        | "billing_interval"
      >
    >,
  ): Promise<boolean> {
    this.ensureInitialized();
    this.ensureWritable();

    const assignments: string[] = [];
    const values: Array<string | number> = [];

    if (updates.feature_flags) {
      assignments.push("feature_flags = ?");
      values.push(JSON.stringify(updates.feature_flags));
    }
    if (updates.plan_tier) {
      assignments.push("plan_tier = ?");
      values.push(updates.plan_tier);
    }
    if (updates.expires_at !== undefined) {
      assignments.push("expires_at = ?");
      values.push(updates.expires_at);
    }
    if (updates.last_renewed !== undefined) {
      assignments.push("last_renewed = ?");
      values.push(updates.last_renewed);
    }
    if (updates.api_rate_limit !== undefined) {
      assignments.push("api_rate_limit = ?");
      values.push(updates.api_rate_limit);
    }
    if (updates.billing_interval !== undefined) {
      assignments.push("billing_interval = ?");
      values.push(updates.billing_interval);
    }

    if (assignments.length === 0) return true;

    try {
      const statement = `UPDATE ${this.config.tableName} SET ${assignments.join(", ")} WHERE nft_token_id = ?`;
      values.push(tokenId);
      await this.dbWrite!.prepare(statement)
        .bind(...values)
        .run();
      return true;
    } catch (err) {
      console.error("[Tableland] updateEntitlementByTokenId error:", err);
      return false;
    }
  }

  async listEntitlements(limit = 100): Promise<TablelandEntitlement[]> {
    this.ensureInitialized();
    const safeLimit = Math.max(1, Math.min(limit, 1000));

    try {
      const statement = `SELECT * FROM ${this.config.tableName} LIMIT ?`;
      const response = await this.dbRead!.prepare(statement)
        .bind(safeLimit)
        .all();
      const rows = (response.results || []) as Array<Record<string, unknown>>;
      return rows.map((row) => ({
        wallet_address: String(row.wallet_address || ""),
        nft_token_id: Number(row.nft_token_id || 0),
        plan_tier: String(row.plan_tier || "starter"),
        feature_flags:
          typeof row.feature_flags === "string"
            ? (JSON.parse(row.feature_flags) as Record<
                string,
                boolean | string | number
              >)
            : ((row.feature_flags || {}) as Record<
                string,
                boolean | string | number
              >),
        api_rate_limit: Number(row.api_rate_limit || 0),
        billing_interval: Number(row.billing_interval || 0),
        last_renewed: Number(row.last_renewed || 0),
        expires_at: Number(row.expires_at || 0),
        chain_id: Number(row.chain_id || this.config.chainId),
      }));
    } catch (err) {
      console.error("[Tableland] listEntitlements error:", err);
      return [];
    }
  }

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
      api_rate_limit: this.defaultRateLimitForTier(data.planTier),
      feature_flags: data.features,
    });
  }

  async listTierFeatureFlags(
    providerAddress: string,
    tiers: string[] = ["starter", "pro", "enterprise"],
  ): Promise<TierFlagsMatrix> {
    const matrix: TierFlagsMatrix = {};
    for (const tier of tiers) {
      const key = this.buildTierMatrixKey(providerAddress, tier);
      matrix[tier] = await this.getFeatureFlags(key);
    }
    return matrix;
  }

  async setTierFeatureFlags(
    providerAddress: string,
    tier: string,
    flags: Record<string, boolean | string | number>,
  ): Promise<boolean> {
    const key = this.buildTierMatrixKey(providerAddress, tier);
    return this.setFeatureFlags(key, flags, {
      wallet_address: key,
      nft_token_id: 0,
      plan_tier: tier,
      expires_at: 0,
      billing_interval: 0,
      last_renewed: Math.floor(Date.now() / 1000),
      chain_id: this.config.chainId,
      api_rate_limit: this.defaultRateLimitForTier(tier),
      feature_flags: flags,
    });
  }

  private buildTierMatrixKey(providerAddress: string, tier: string): string {
    return `matrix:${providerAddress.toLowerCase()}:${tier.toLowerCase()}`;
  }

  private defaultRateLimitForTier(tier: string): number {
    if (tier === "enterprise") return 10000;
    if (tier === "pro") return 5000;
    return 1000;
  }

  private ensureInitialized(): void {
    if (!this.initialized || !this.dbRead) {
      throw new Error(
        "[Tableland] Service not initialized. Call initialize() first.",
      );
    }
  }

  private ensureWritable(): void {
    if (!this.dbWrite) {
      throw new Error(
        "[Tableland] Write requested without signer. Set TABLELAND_PRIVATE_KEY + TABLELAND_RPC_URL.",
      );
    }
  }

  private ensureSafeTableName(): void {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(this.config.tableName)) {
      throw new Error(
        `[Tableland] Unsafe table name "${this.config.tableName}". Expected alphanumeric/underscore only.`,
      );
    }
  }
}
