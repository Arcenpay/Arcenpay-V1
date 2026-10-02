// ============================================================
//  ArcenPay Facilitator — Solana Chain Adapter
//
//  Implements `ChainAdapter` for the Solana family using the
//  @solana/web3.js JSON-RPC client:
//
//    • connection.getSignaturesForAddress(programId) — poll for new
//      transactions touching the ArcenPay Anchor program(s)
//    • connection.getParsedTransaction(signature)    — fetch logs
//    • Anchor `emit!` events are written as `Program data: <base64>`
//      log lines; they are decoded by solana-event-codec.ts.
//
//  The event/account layouts mirror the ArcenPay Anchor program
//  (packages/solana-programs). The decoding is unit-tested in
//  tests/solana-event-codec.test.ts.
//
//  The adapter never submits transactions — it only reads. Renewals
//  are handled by a dedicated driver (see stellar-renewal-driver.ts
//  for the analogous pattern).
// ============================================================

import { Connection, PublicKey } from "@solana/web3.js";
import {
  getContractAddresses,
  getSolanaRpcUrl,
  type ChainFamily,
} from "@arcenpay/internal-core";
import type {
  ChainAdapter,
  EventCallback,
  NormalisedSubscriptionEventType,
  NormalisedSubscriptionEvent,
} from "./chain-adapter.js";
import {
  PROGRAM_DATA_LOG_PREFIX,
  decodeAnchorEventPayload,
  decodeSubscriptionRecord,
  u64le,
} from "./solana-event-codec.js";
import { createSolanaConnection } from "./solana-instruction-codec.js";

// ─── Config ─────────────────────────────────────────────────────────────────

export interface SolanaChainAdapterConfig {
  /** Solana synthetic chainId (9_100_000 / 9_100_001 / 9_100_002). */
  chainId: number;
  /** Optional JSON-RPC URL override; falls back to getSolanaRpcUrl(). */
  rpcUrl?: string;
  /** Polling interval in milliseconds. Default: 15_000 (15s). */
  pollIntervalMs?: number;
}

// ─── Implementation ─────────────────────────────────────────────────────────

export class SolanaChainAdapter implements ChainAdapter {
  readonly family: ChainFamily = "solana";
  readonly chainId: number;
  private readonly rpcUrl: string;
  private readonly subscriptionRegistryProgramId: string;
  private readonly autopayProgramId: string;
  private readonly pollIntervalMs: number;

  private connection: Connection | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  /** Most recent signature seen per program id (pagination cursor). */
  private lastSignature: Map<string, string | null> = new Map();
  private seenSignatures = new Set<string>();
  private callbacks = new Map<
    NormalisedSubscriptionEventType | "*",
    EventCallback[]
  >();

  constructor(config: SolanaChainAdapterConfig) {
    this.chainId = config.chainId;
    this.rpcUrl = config.rpcUrl || getSolanaRpcUrl(config.chainId);
    this.pollIntervalMs = config.pollIntervalMs ?? 15_000;

    if (!this.rpcUrl) {
      throw new Error(
        `[SolanaChainAdapter] No Solana RPC URL configured for chain ${config.chainId}. ` +
          `Set ARCENPAY_SOLANA_RPC_URL_${config.chainId} or SOLANA_RPC_URL_${config.chainId} ` +
          `in env, or pass rpcUrl in the config.`,
      );
    }

    const contracts = getContractAddresses(config.chainId);
    this.subscriptionRegistryProgramId = contracts.subscriptionRegistry;
    this.autopayProgramId = contracts.autopayModule;

    if (!this.subscriptionRegistryProgramId) {
      console.warn(
        `[SolanaChainAdapter] No subscription-registry program id configured ` +
          `for chain ${config.chainId}. Set ARCENPAY_CONTRACT_${config.chainId}_subscriptionRegistry. ` +
          `Event polling will be a no-op until the program is deployed.`,
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

    if (!this.subscriptionRegistryProgramId) {
      console.warn(
        `[SolanaChainAdapter] No subscription-registry program configured. ` +
          `Event listener will not start.`,
      );
      return;
    }

    this.connection = createSolanaConnection(this.chainId);
    console.log(
      `[SolanaChainAdapter] Starting event listener for chain ${this.chainId} ` +
        `(rpc=${this.rpcUrl})`,
    );

    const effectiveInterval = intervalMs ?? this.pollIntervalMs;
    this.pollTimer = setInterval(() => {
      void this.poll().catch((err) => {
        console.error(
          `[SolanaChainAdapter] Poll error (chain ${this.chainId}):`,
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
        `[SolanaChainAdapter] Event listener stopped for chain ${this.chainId}`,
      );
    }
  }

  // ── view reads ──────────────────────────────────────────────────────────
  //
  // Unlike the Stellar adapter (which ships read stubs), these perform a
  // real account read. The subscription record PDA layout mirrors the
  // Anchor program; if the account is absent the token does not exist.

  async getSubscriptionOwner(tokenId: string): Promise<string | null> {
    const record = await this.readSubscriptionRecord(tokenId);
    return record?.owner ?? null;
  }

  async isSubscriptionValid(tokenId: string): Promise<boolean> {
    const record = await this.readSubscriptionRecord(tokenId);
    if (!record) return false;
    if (!record.active) return false;
    return record.expiration > BigInt(Math.floor(Date.now() / 1000));
  }

  private async readSubscriptionRecord(
    tokenId: string,
  ): Promise<{ owner: string; active: boolean; expiration: bigint } | null> {
    if (!this.subscriptionRegistryProgramId) return null;
    try {
      if (!this.connection) {
        this.connection = createSolanaConnection(this.chainId);
      }
      const programId = new PublicKey(this.subscriptionRegistryProgramId);
      const [pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("subscription"), Buffer.from(u64le(BigInt(tokenId)))],
        programId,
      );
      const account = await this.connection.getAccountInfo(pda);
      if (!account) return null;
      return decodeSubscriptionRecord(account.data);
    } catch (err) {
      console.warn(
        `[SolanaChainAdapter] getSubscription(${tokenId}) failed:`,
        err instanceof Error ? err.message : String(err),
      );
      return null;
    }
  }

  // ── event polling ───────────────────────────────────────────────────────

  private async poll(): Promise<void> {
    if (!this.connection) return;

    const programs = [
      this.subscriptionRegistryProgramId,
      this.autopayProgramId,
    ].filter(Boolean);

    for (const programId of programs) {
      try {
        await this.pollProgram(programId);
      } catch (err) {
        console.error(
          `[SolanaChainAdapter] Poll error for program ${programId} (chain ${this.chainId}):`,
          err,
        );
      }
    }
  }

  private async pollProgram(programId: string): Promise<void> {
    if (!this.connection) return;
    const until = this.lastSignature.get(programId) ?? undefined;

    const signatures = await this.connection.getSignaturesForAddress(
      new PublicKey(programId),
      { until, limit: 50 },
      "confirmed",
    );
    if (signatures.length === 0) return;

    // getSignaturesForAddress returns newest-first; process oldest-first.
    for (const entry of [...signatures].reverse()) {
      if (!entry.signature || this.seenSignatures.has(entry.signature)) continue;
      this.seenSignatures.add(entry.signature);
      await this.processTransaction(entry.signature);
    }

    // Cursor = newest signature (first element).
    this.lastSignature.set(programId, signatures[0].signature);
  }

  private async processTransaction(signature: string): Promise<void> {
    if (!this.connection) return;
    const tx = await this.connection.getParsedTransaction(signature, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });
    const logs = tx?.meta?.logMessages ?? [];
    if (logs.length === 0) return;

    const slot = tx?.slot ?? 0;
    const blockTime = tx?.blockTime ?? Math.floor(Date.now() / 1000);

    for (const log of logs) {
      if (!log.startsWith(PROGRAM_DATA_LOG_PREFIX)) continue;
      let payload: Buffer;
      try {
        payload = Buffer.from(
          log.slice(PROGRAM_DATA_LOG_PREFIX.length),
          "base64",
        );
      } catch {
        continue;
      }

      const event = decodeAnchorEventPayload(payload, {
        signature,
        slot: String(slot),
        timestamp: blockTime,
      });
      if (event) {
        console.log(
          `[SolanaChainAdapter] ${event.type} — tokenId=${event.tokenId} tx=${signature}`,
        );
        await this.dispatch(event);
      }
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
          `[SolanaChainAdapter] Callback error for ${event.type}:`,
          err,
        );
      }
    }
  }
}
