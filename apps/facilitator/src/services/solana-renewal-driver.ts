// ============================================================
//  ArcenPay Facilitator — Solana Renewal (relayer) Worker
//
//  The Solana "keeper". The ArcenPay Anchor program has no
//  time-triggered renewal: someone must submit `execute` once a
//  subscription's `expiration` has passed for money to move.
//
//  Solana authorization model: at subscribe time the subscriber
//  approves a per-(owner, mint) PDA as an SPL token delegate. The
//  program itself signs the SPL transfer as that PDA, so the
//  facilitator needs only a funded RELAYER keypair to pay fees. It
//  never holds — and never needs — a subscriber key.
//
//  Discovery: every `Subscription` account is enumerated straight
//  from the chain (getProgramAccounts + the Anchor account
//  discriminator), so there is no off-chain index to keep in sync
//  and no custodial key list. Due-ness comes from the on-chain
//  `expiration`, so — unlike the Stellar driver — there is no
//  in-memory scheduling state to lose.
// ============================================================

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { getContractAddresses, getSolanaRpcUrl } from "@arcenpay/internal-core";
import {
  accountDiscriminator,
  decodeTokenAccountDelegation,
  encodeBase58,
  encodeExecute,
  findPlanPda,
  findSubscriptionPda,
  findSubscriptionDelegatePda,
  findConfigPda,
  createSolanaConnection,
  parseSolanaSecretKey,
  TOKEN_PROGRAM_ID,
} from "./solana-instruction-codec.js";
import { decodeSubscriptionRecord } from "./solana-event-codec.js";

export interface SolanaRenewalDriverConfig {
  /** Solana synthetic chainId (9_100_000 / 9_100_001 / 9_100_002). */
  chainId: number;
  /** Polling interval in ms (default 60_000). */
  intervalMs?: number;
  /**
   * Base58 or JSON-array 64-byte secret key of the relayer that pays network
   * fees. It has no spending authority — the subscription delegate PDA does.
   */
  relayerKey: string;
  /** Max due subscriptions processed per pass (default 25). */
  batchSize?: number;
  /** Consecutive failures before a subscription is parked (default 5). */
  maxConsecutiveFailures?: number;
}

export type SolanaRenewalOutcome =
  | "renewed"
  | "not_due"
  | "skipped"
  | "reauthorization_required"
  | "failed";

export interface SolanaRenewalResult {
  wallet: string;
  tokenId: string;
  due: boolean;
  charged: boolean;
  outcome: SolanaRenewalOutcome;
  txHash?: string;
  error?: string;
}

/** True when a subscription (unix-seconds expiration) is due for renewal. */
export function isRenewalDue(expiration: bigint, nowSeconds: number): boolean {
  return Number(expiration) <= nowSeconds;
}

/** Anchor account discriminator for `Subscription`, as a base58 memcmp filter. */
export const SUBSCRIPTION_DISCRIMINATOR_BASE58 = encodeBase58(
  accountDiscriminator("Subscription"),
);

export class SolanaRenewalDriver {
  private readonly chainId: number;
  private readonly intervalMs: number;
  private readonly batchSize: number;
  private readonly maxConsecutiveFailures: number;
  private readonly relayer: Keypair;
  private readonly rpcUrl: string;
  private readonly programId: string;
  private connection: Connection | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private processing = false;
  private callbacks: Array<(result: SolanaRenewalResult) => void> = [];
  /** tokenId → consecutive failure count (parked once it hits the cap). */
  private failures = new Map<string, number>();
  private lastRunAt: string | null = null;

  constructor(config: SolanaRenewalDriverConfig) {
    this.chainId = config.chainId;
    this.intervalMs = config.intervalMs ?? 60_000;
    this.batchSize = config.batchSize ?? 25;
    this.maxConsecutiveFailures = config.maxConsecutiveFailures ?? 5;
    this.rpcUrl = getSolanaRpcUrl(config.chainId);
    const contracts = getContractAddresses(config.chainId);
    this.programId =
      contracts.subscriptionRegistry ||
      contracts.autopayModule ||
      contracts.planFactory ||
      "";

    if (!config.relayerKey?.trim()) {
      throw new Error(
        "[SolanaRenewalDriver] No relayer key configured. Set " +
          "SOLANA_RELAYER_PRIVATE_KEY to a base58 or JSON 64-byte Solana " +
          "keypair secret (the relayer pays network fees only).",
      );
    }
    this.relayer = Keypair.fromSecretKey(
      parseSolanaSecretKey(config.relayerKey),
    );

    if (!this.rpcUrl) {
      throw new Error(
        `[SolanaRenewalDriver] No Solana RPC URL configured for chain ${config.chainId}.`,
      );
    }
    if (!this.programId) {
      throw new Error(
        `[SolanaRenewalDriver] No ArcenPay program id configured for chain ${config.chainId}.`,
      );
    }
  }

  getRelayerAddress(): string {
    return this.relayer.publicKey.toBase58();
  }

  getStats(): {
    running: boolean;
    relayer: string;
    lastRunAt: string | null;
    parked: number;
  } {
    return {
      running: this.pollTimer !== null,
      relayer: this.getRelayerAddress(),
      lastRunAt: this.lastRunAt,
      parked: this.failures.size,
    };
  }

  onRenewal(cb: (result: SolanaRenewalResult) => void): void {
    this.callbacks.push(cb);
  }

  start(): void {
    if (this.pollTimer) return;
    this.connection = createSolanaConnection(this.chainId);
    // Immediate first pass, then poll.
    void this.runOnce().catch((err) =>
      console.error("[SolanaRenewalDriver] initial run error:", err),
    );
    this.pollTimer = setInterval(() => {
      void this.runOnce().catch((err) =>
        console.error("[SolanaRenewalDriver] poll error:", err),
      );
    }, this.intervalMs);
    console.log(
      `[SolanaRenewalDriver] Started for chain ${this.chainId} ` +
        `(relayer ${this.getRelayerAddress()}, interval ${this.intervalMs}ms)`,
    );
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
      console.log("[SolanaRenewalDriver] Stopped");
    }
  }

  async runOnce(): Promise<SolanaRenewalResult[]> {
    if (this.processing) return [];
    this.processing = true;
    const results: SolanaRenewalResult[] = [];
    try {
      const now = Math.floor(Date.now() / 1000);
      this.lastRunAt = new Date().toISOString();

      for (const { wallet, tokenId, account } of await this.discoverDue(now)) {
        let result: SolanaRenewalResult;
        try {
          result = await this.processRenewal(wallet, tokenId, account, now);
        } catch (err) {
          result = {
            wallet,
            tokenId,
            due: true,
            charged: false,
            outcome: "failed",
            error: err instanceof Error ? err.message : String(err),
          };
          this.recordFailure(tokenId);
          console.error(`[SolanaRenewalDriver] ${wallet} failed:`, err);
        }
        results.push(result);
        if (result.outcome === "renewed") {
          this.failures.delete(tokenId);
        }
        for (const cb of this.callbacks) cb(result);
      }
    } finally {
      this.processing = false;
    }
    return results;
  }

  /**
   * Enumerate on-chain subscriptions and keep only the ones that are due and
   * still eligible for automatic collection, newest-expiring first.
   */
  private async discoverDue(
    now: number,
  ): Promise<
    Array<{
      wallet: string;
      tokenId: string;
      account: NonNullable<ReturnType<typeof decodeSubscriptionRecord>>;
    }>
  > {
    const connection = this.connection;
    if (!connection) throw new Error("SolanaRenewalDriver not started");

    const programId = new PublicKey(this.programId);
    const accounts = await connection.getProgramAccounts(programId, {
      filters: [
        { memcmp: { offset: 0, bytes: SUBSCRIPTION_DISCRIMINATOR_BASE58 } },
      ],
    });

    const due: Array<{
      wallet: string;
      tokenId: string;
      account: NonNullable<ReturnType<typeof decodeSubscriptionRecord>>;
      expiration: bigint;
    }> = [];

    for (const { account } of accounts) {
      const record = decodeSubscriptionRecord(account.data as Buffer);
      if (!record) continue;
      if (!record.active || !record.autopayEnabled) continue;
      const tokenId = record.tokenId.toString();
      if (this.isParked(tokenId)) continue;
      if (record.remainingRenewals <= 0) continue;
      if (record.authorizationExpiresAt <= BigInt(now)) continue;
      if (!isRenewalDue(record.expiration, now)) continue;
      due.push({
        wallet: record.owner,
        tokenId,
        account: record,
        expiration: record.expiration,
      });
    }

    due.sort((a, b) => (a.expiration < b.expiration ? -1 : 1));
    return due.slice(0, this.batchSize);
  }

  private isParked(tokenId: string): boolean {
    return (this.failures.get(tokenId) ?? 0) >= this.maxConsecutiveFailures;
  }

  private recordFailure(tokenId: string): void {
    const next = (this.failures.get(tokenId) ?? 0) + 1;
    this.failures.set(tokenId, next);
    if (next === this.maxConsecutiveFailures) {
      console.error(
        `[SolanaRenewalDriver] tokenId=${tokenId} parked after ${next} consecutive ` +
          `failures — needs operator attention (reauthorize or top up).`,
      );
    }
  }

  private async processRenewal(
    wallet: string,
    tokenId: string,
    sub: NonNullable<ReturnType<typeof decodeSubscriptionRecord>>,
    now: number,
  ): Promise<SolanaRenewalResult> {
    const base = { wallet, tokenId, due: true, charged: false } as const;
    const connection = this.connection;
    if (!connection) throw new Error("SolanaRenewalDriver not started");
    const programId = new PublicKey(this.programId);

    if (sub.remainingRenewals <= 0) {
      return {
        ...base,
        outcome: "reauthorization_required",
        error: "renewal budget exhausted — owner must reauthorize autopay",
      };
    }
    if (sub.authorizationExpiresAt <= BigInt(now)) {
      return {
        ...base,
        outcome: "reauthorization_required",
        error: "autopay authorization expired — owner must reauthorize",
      };
    }

    const mint = new PublicKey(sub.acceptedToken);
    const [delegatePda] = findSubscriptionDelegatePda(
      programId,
      sub.owner,
      mint,
    );

    // Preflight the SPL delegation: if another app (or subscription) replaced
    // our delegate, or the allowance no longer covers the renewal, the on-chain
    // transfer would fail opaquely. Detect it here and report it as an
    // actionable "reauthorization required" instead.
    const payerTokenInfo = await connection.getAccountInfo(
      new PublicKey(sub.subscriberToken),
    );
    const delegation = payerTokenInfo
      ? decodeTokenAccountDelegation(payerTokenInfo.data)
      : null;
    if (!delegation) {
      return { ...base, outcome: "failed", error: "subscriber token account missing" };
    }
    if (delegation.delegate !== delegatePda.toBase58()) {
      return {
        ...base,
        outcome: "reauthorization_required",
        error:
          "SPL delegate was overwritten (another app or subscription) — " +
          "owner must reauthorize autopay",
      };
    }
    if (delegation.delegatedAmount < sub.renewalPrice) {
      return {
        ...base,
        outcome: "reauthorization_required",
        error: `delegated allowance too low (have ${delegation.delegatedAmount}, need ${sub.renewalPrice})`,
      };
    }

    const [planPda] = findPlanPda(programId, sub.planId);
    const [configPda] = findConfigPda(programId);
    const [subscriptionPda] = findSubscriptionPda(programId, sub.tokenId);

    const instruction = new TransactionInstruction({
      programId,
      keys: [
        { pubkey: configPda, isSigner: false, isWritable: false },
        { pubkey: planPda, isSigner: false, isWritable: false },
        { pubkey: subscriptionPda, isSigner: false, isWritable: true },
        // The relayer is the fee payer only — no spending authority.
        { pubkey: this.relayer.publicKey, isSigner: true, isWritable: true },
        { pubkey: delegatePda, isSigner: false, isWritable: false },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: new PublicKey(sub.subscriberToken), isSigner: false, isWritable: true },
        { pubkey: new PublicKey(sub.providerToken), isSigner: false, isWritable: true },
        { pubkey: new PublicKey(sub.treasuryToken), isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: encodeExecute(),
    });

    const txHash = await sendAndConfirmTransaction(
      connection,
      new Transaction().add(instruction),
      [this.relayer],
      { commitment: "confirmed" },
    );

    return { ...base, charged: true, outcome: "renewed", txHash };
  }
}
