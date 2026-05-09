// ============================================================
//  @arcenpay/node — Redis Usage Store
//  Persistent usage log storage for x402/settlement pipelines
// ============================================================

import { createClient, type RedisClientType } from "redis";

export interface RedisUsageStoreConfig {
  url: string;
  keyPrefix?: string;
  ttlSeconds?: number;
}

export interface PersistedUsageEntry {
  sessionId: string;
  signer?: string;
  endpoint: string;
  method: string;
  timestamp: number;
  amount?: string;
  settlementTxHash?: string | null;
}

function sessionKey(prefix: string, sessionId: string): string {
  return `${prefix}:usage:${sessionId}`;
}

function settlementKey(prefix: string): string {
  return `${prefix}:settlement:latest`;
}

export class RedisUsageStore {
  private readonly config: Required<RedisUsageStoreConfig>;
  private readonly client: RedisClientType;
  private connected = false;

  constructor(config: RedisUsageStoreConfig) {
    this.config = {
      keyPrefix: "meap",
      ttlSeconds: 7 * 24 * 60 * 60,
      ...config,
    };

    this.client = createClient({ url: this.config.url });
    this.client.on("error", (err) => {
      console.error("[RedisUsageStore] Redis error:", err);
    });
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    await this.client.connect();
    this.connected = true;
  }

  async appendUsage(entry: PersistedUsageEntry): Promise<void> {
    if (!this.connected) {
      await this.connect();
    }

    const key = sessionKey(this.config.keyPrefix, entry.sessionId);
    await this.client.rPush(key, JSON.stringify(entry));
    await this.client.expire(key, this.config.ttlSeconds);
  }

  async getUsageCount(sessionId: string): Promise<number> {
    if (!this.connected) {
      await this.connect();
    }
    return this.client.lLen(sessionKey(this.config.keyPrefix, sessionId));
  }

  async getUsageEntries(
    sessionId: string,
    limit = 100,
  ): Promise<PersistedUsageEntry[]> {
    if (!this.connected) {
      await this.connect();
    }

    const upper = Math.max(0, limit - 1);
    const values = await this.client.lRange(
      sessionKey(this.config.keyPrefix, sessionId),
      0,
      upper,
    );
    return values
      .map((value) => {
        try {
          return JSON.parse(value) as PersistedUsageEntry;
        } catch {
          return null;
        }
      })
      .filter((value): value is PersistedUsageEntry => value !== null);
  }

  async setLatestSettlementTx(
    sessionId: string,
    txHash: string,
  ): Promise<void> {
    if (!this.connected) {
      await this.connect();
    }

    await this.client.hSet(
      settlementKey(this.config.keyPrefix),
      sessionId,
      txHash,
    );
    await this.client.expire(
      settlementKey(this.config.keyPrefix),
      this.config.ttlSeconds,
    );
  }

  async getLatestSettlementTx(sessionId: string): Promise<string | null> {
    if (!this.connected) {
      await this.connect();
    }

    const txHash = await this.client.hGet(
      settlementKey(this.config.keyPrefix),
      sessionId,
    );
    return txHash ?? null;
  }

  async stop(): Promise<void> {
    if (this.connected) {
      await this.client.quit();
      this.connected = false;
    }
  }
}
