// ============================================================
//  ArcenPay Facilitator — Solana Renewal Driver
//
//  The Solana "keeper". The ArcenPay Anchor program has no
//  time-triggered renewal: someone must submit `execute` once a
//  subscription's `expiration` has passed for money to move.
//
//  Solana authorization model: `execute` transfers FROM the payer's
//  token account, so the payer must sign. A server cannot autonomously
//  charge a wallet it does not control. This driver therefore only
//  auto-renews subscribers whose keypairs are explicitly configured
//  (`SOLANA_RENEWAL_KEYS`), covering platform/demo/self-hosted agent
//  wallets. Third-party subscribers must co-sign (the same
//  prepared-transaction pattern the backend activation route uses).
//
//  Due-ness is derived from the on-chain `Subscription.expiration`, so
//  unlike the Stellar driver there is no in-memory state to lose.
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
  encodeExecute,
  findAssociatedTokenAddress,
  findConfigPda,
  findPlanPda,
  findSubscriptionByWalletPda,
  findSubscriptionPda,
  parseSolanaSecretKey,
  TOKEN_PROGRAM_ID,
} from "./solana-instruction-codec.js";
import {
  decodeConfigRecord,
  decodePlanRecord,
  decodeSubscriptionByWallet,
  decodeSubscriptionRecord,
} from "./solana-event-codec.js";

export interface SolanaRenewalDriverConfig {
  /** Solana synthetic chainId (9_100_000 / 9_100_001 / 9_100_002). */
  chainId: number;
  /** Polling interval in ms (default 60_000). */
  intervalMs?: number;
  /** `;`-separated `<base58-pubkey>:<base58-or-JSON-secret>` subscriber keypairs. */
  subscriberKeys?: string;
}

export interface SolanaRenewalResult {
  wallet: string;
  due: boolean;
  charged: boolean;
  txHash?: string;
  error?: string;
}

/** True when a subscription (unix-seconds expiration) is due for renewal. */
export function isRenewalDue(expiration: bigint, nowSeconds: number): boolean {
  return Number(expiration) <= nowSeconds;
}

/** Parses the `pubkey:secret` list into keypairs (invalid entries skipped). */
export function parseSubscriberKeys(
  input: string | undefined,
): Map<string, Keypair> {
  const keypairs = new Map<string, Keypair>();
  // Entries are separated by ';' or newline — NOT ',' — because a Solana
  // secret may be a JSON byte array (`[1,2,…]`) which itself contains commas.
  for (const entry of (input ?? "").split(/[;\n]/)) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(":");
    if (idx <= 0) continue;
    const secret = trimmed.slice(idx + 1).trim();
    if (!secret) continue;
    try {
      const keypair = Keypair.fromSecretKey(parseSolanaSecretKey(secret));
      keypairs.set(keypair.publicKey.toBase58(), keypair);
    } catch {
      // Skip malformed key entries.
    }
  }
  return keypairs;
}

export class SolanaRenewalDriver {
  private readonly chainId: number;
  private readonly intervalMs: number;
  private readonly keypairs: Map<string, Keypair>;
  private readonly rpcUrl: string;
  private readonly programId: string;
  private connection: Connection | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private processing = false;
  private callbacks: Array<(result: SolanaRenewalResult) => void> = [];

  constructor(config: SolanaRenewalDriverConfig) {
    this.chainId = config.chainId;
    this.intervalMs = config.intervalMs ?? 60_000;
    this.rpcUrl = getSolanaRpcUrl(config.chainId);
    const contracts = getContractAddresses(config.chainId);
    this.programId =
      contracts.subscriptionRegistry ||
      contracts.autopayModule ||
      contracts.planFactory ||
      "";
    this.keypairs = parseSubscriberKeys(config.subscriberKeys);

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

  onRenewal(cb: (result: SolanaRenewalResult) => void): void {
    this.callbacks.push(cb);
  }

  start(): void {
    if (this.pollTimer) return;
    this.connection = new Connection(this.rpcUrl, "confirmed");
    this.pollTimer = setInterval(() => {
      void this.runOnce().catch((err) =>
        console.error("[SolanaRenewalDriver] poll error:", err),
      );
    }, this.intervalMs);
    console.log(
      `[SolanaRenewalDriver] Started for chain ${this.chainId} ` +
        `(${this.keypairs.size} subscriber key(s), interval ${this.intervalMs}ms)`,
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
      for (const [wallet, keypair] of this.keypairs) {
        try {
          const result = await this.processSubscriber(wallet, keypair);
          results.push(result);
          if (result.charged) {
            for (const cb of this.callbacks) cb(result);
          }
        } catch (err) {
          const result: SolanaRenewalResult = {
            wallet,
            due: false,
            charged: false,
            error: err instanceof Error ? err.message : String(err),
          };
          results.push(result);
          console.error(`[SolanaRenewalDriver] ${wallet} failed:`, err);
        }
      }
    } finally {
      this.processing = false;
    }
    return results;
  }

  private async processSubscriber(
    wallet: string,
    keypair: Keypair,
  ): Promise<SolanaRenewalResult> {
    const connection = this.connection;
    if (!connection) {
      throw new Error("SolanaRenewalDriver not started");
    }
    const programId = new PublicKey(this.programId);

    const [byWallet] = findSubscriptionByWalletPda(programId, wallet);
    const linkInfo = await connection.getAccountInfo(byWallet);
    if (!linkInfo) {
      return { wallet, due: false, charged: false, error: "no subscription" };
    }
    const link = decodeSubscriptionByWallet(linkInfo.data);
    if (!link) {
      return { wallet, due: false, charged: false, error: "undecodable link" };
    }

    const [subPda] = findSubscriptionPda(programId, link.tokenId);
    const subInfo = await connection.getAccountInfo(subPda);
    const sub = subInfo ? decodeSubscriptionRecord(subInfo.data) : null;
    if (!sub) {
      return { wallet, due: false, charged: false, error: "subscription missing" };
    }
    if (!sub.active) {
      return { wallet, due: false, charged: false };
    }

    const now = Math.floor(Date.now() / 1000);
    if (!isRenewalDue(sub.expiration, now)) {
      return { wallet, due: false, charged: false };
    }

    const [planPda] = findPlanPda(programId, sub.planId);
    const planInfo = await connection.getAccountInfo(planPda);
    const plan = planInfo ? decodePlanRecord(planInfo.data) : null;
    if (!plan || !plan.active) {
      return { wallet, due: true, charged: false, error: "plan inactive" };
    }

    const [configPda] = findConfigPda(programId);
    const configInfo = await connection.getAccountInfo(configPda);
    const config = configInfo ? decodeConfigRecord(configInfo.data) : null;
    if (!config) {
      return { wallet, due: true, charged: false, error: "program config missing" };
    }

    const mint = new PublicKey(plan.acceptedToken);
    const payerAta = findAssociatedTokenAddress(keypair.publicKey, mint);
    const providerAta = findAssociatedTokenAddress(plan.provider, mint);
    const treasuryAta = findAssociatedTokenAddress(config.treasury, mint);

    const instruction = new TransactionInstruction({
      programId,
      keys: [
        { pubkey: configPda, isSigner: false, isWritable: false },
        { pubkey: planPda, isSigner: false, isWritable: false },
        { pubkey: subPda, isSigner: false, isWritable: true },
        { pubkey: keypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: payerAta, isSigner: false, isWritable: true },
        { pubkey: providerAta, isSigner: false, isWritable: true },
        { pubkey: treasuryAta, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: encodeExecute(plan.price),
    });

    const txHash = await sendAndConfirmTransaction(
      connection,
      new Transaction().add(instruction),
      [keypair],
      { commitment: "confirmed" },
    );

    return { wallet, due: true, charged: true, txHash };
  }
}
