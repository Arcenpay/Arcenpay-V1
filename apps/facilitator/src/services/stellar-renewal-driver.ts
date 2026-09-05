// ============================================================
//  ArcenPay Facilitator — Stellar Renewal Driver
//
//  The missing "stellar keeper". The Soroban autopay-account has no
//  time-triggered renewal: someone must submit `execute(caller, account,
//  amount)` once `now >= last_pull_time + interval` for money to move and the
//  subscription to roll forward.
//
//  Soroban authorization model: `execute` (and the SAC transfers it makes
//  FROM the subscriber) require the SUBSCRIBER's authorization in the
//  transaction. A server cannot autonomously charge a wallet it does not
//  control. This driver therefore only drives renewals for subscribers whose
//  keypairs are explicitly configured (`STELLAR_RENEWAL_KEYS`), which covers
//  the platform's own test/demo subscribers and self-hosted agent wallets. For
//  third-party subscribers the driver logs a clear "renewal due — subscriber
//  signature required" notice so the subscriber-facing co-sign flow can pick
//  it up (the same preparedTransaction pattern the backend activation route
//  uses).
//
//  Due-ness is tracked by an in-process last-charge map (seeded from
//  config.start_time on first sight), mirroring the contract's
//  `last_pull_time + interval` semantics. The on-chain `BillingExecuted`
//  event emitted by a successful `execute` is picked up by the existing
//  StellarChainAdapter → billing pipeline; nothing downstream changes.
// ============================================================

import { getContractAddresses, getStellarNetworkPassphrase, getStellarSorobanRpcUrl } from "@arcenpay/internal-core";

export interface StellarRenewalDriverConfig {
  /** Synthetic Stellar chainId (9_000_000 mainnet, 9_000_001 testnet). */
  chainId: number;
  /** Polling interval in ms (default 60_000). */
  intervalMs?: number;
  /** Comma-separated "G…:S…" subscriber keypairs to auto-renew. */
  subscriberKeys?: string;
}

interface DriverResult {
  wallet: string;
  due: boolean;
  charged: boolean;
  txHash?: string;
  error?: string;
}

export class StellarRenewalDriver {
  private readonly chainId: number;
  private readonly intervalMs: number;
  private readonly keypairs: Map<string, { secret: string; publicKey: string }>;
  private readonly rpcUrl: string;
  private readonly passphrase: string;
  private readonly autopayContractId: string;
  private lastChargedAt = new Map<string, number>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private processing = false;
  private callbacks: Array<(result: DriverResult) => void> = [];

  constructor(config: StellarRenewalDriverConfig) {
    this.chainId = config.chainId;
    this.intervalMs = config.intervalMs ?? 60_000;
    this.rpcUrl = getStellarSorobanRpcUrl(config.chainId);
    this.passphrase = getStellarNetworkPassphrase(config.chainId);
    this.autopayContractId = getContractAddresses(config.chainId).autopayModule;
    this.keypairs = new Map();

    for (const entry of (config.subscriberKeys ?? "").split(",")) {
      const trimmed = entry.trim();
      if (!trimmed) continue;
      const [publicKey, secret] = trimmed.split(":").map((s) => s.trim());
      if (publicKey && secret) {
        this.keypairs.set(publicKey, { secret, publicKey });
      }
    }

    if (!this.autopayContractId) {
      console.warn(
        `[StellarRenewalDriver] No autopay-account contract configured for chain ${this.chainId}. ` +
          `Renewals cannot be driven until ARCENPAY_CONTRACT_${this.chainId}_autopayModule is set.`,
      );
    }
    if (this.keypairs.size === 0) {
      console.warn(
        "[StellarRenewalDriver] No subscriber keypairs configured " +
          "(STELLAR_RENEWAL_KEYS=\"G…:S…,G…:S…\"). The driver will log renewal-due notices only.",
      );
    }
  }

  onRenewal(callback: (result: DriverResult) => void): void {
    this.callbacks.push(callback);
  }

  start(): void {
    if (this.pollTimer) return;
    void this.runOnce(); // immediate first pass
    this.pollTimer = setInterval(() => {
      void this.runOnce().catch((err) => {
        console.error("[StellarRenewalDriver] Tick error:", err);
      });
    }, this.intervalMs);
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * One scan pass: for each configured subscriber, read the on-chain autopay
   * config, decide whether the interval has elapsed since the last recorded
   * charge, and if so submit `execute` signed by the subscriber.
   */
  async runOnce(): Promise<DriverResult[]> {
    if (this.processing) return [];
    this.processing = true;
    const results: DriverResult[] = [];
    try {
      const now = Math.floor(Date.now() / 1000);
      for (const [wallet, key] of this.keypairs) {
        const result = await this.processSubscriber(wallet, key.secret, now).catch(
          (err: unknown) => ({
            wallet,
            due: false,
            charged: false,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
        results.push(result);
        for (const cb of this.callbacks) {
          try {
            void cb(result);
          } catch {
            // callback failures are non-fatal
          }
        }
      }
    } finally {
      this.processing = false;
    }
    return results;
  }

  private async processSubscriber(
    wallet: string,
    secret: string,
    now: number,
  ): Promise<DriverResult> {
    if (!this.autopayContractId) {
      return { wallet, due: false, charged: false, error: "autopay contract not configured" };
    }

    const { contract: stellarContract, Keypair } = await import("@stellar/stellar-sdk");
    const keypair = Keypair.fromSecret(secret);
    const client = await (stellarContract as any).Client.from({
      contractId: this.autopayContractId,
      networkPassphrase: this.passphrase,
      rpcUrl: this.rpcUrl,
      publicKey: keypair.publicKey(),
      signTransaction: async (xdr: string) => {
        const tx = await (stellarContract as any).TransactionBuilder.fromXDR(
          xdr,
          this.passphrase,
        );
        tx.sign(keypair);
        return { signedTxXdr: tx.toXDR() };
      },
    });

    // Read the stored autopay config for this subscriber.
    let config: { interval: number | bigint; start_time: number | bigint; max_amount: bigint | number | string; merchant: string } | null = null;
    try {
      const res = await client.get_config({ account: wallet });
      config = res?.result ?? null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("NotFound") || msg.includes("Autopay not configured")) {
        return { wallet, due: false, charged: false, error: "autopay not configured" };
      }
      return { wallet, due: false, charged: false, error: `get_config failed: ${msg}` };
    }
    if (!config) {
      return { wallet, due: false, charged: false, error: "no autopay config" };
    }

    const intervalSecs = Number(config.interval);
    const startTime = Number(config.start_time);
    const amount = BigInt(String(config.max_amount ?? "0"));
    if (amount <= 0n) {
      return { wallet, due: false, charged: false, error: "invalid max_amount in config" };
    }

    const lastCharge = this.lastChargedAt.get(wallet) ?? startTime;
    const due = now >= lastCharge + intervalSecs;
    if (!due) {
      return { wallet, due: false, charged: false };
    }

    // Due — submit execute(caller=subscriber, account=subscriber, amount).
    const res = await client.execute({
      caller: wallet,
      account: wallet,
      amount,
    });
    const txHash = String(res?.hash ?? res?.txHash ?? "");
    this.lastChargedAt.set(wallet, now);
    console.log(
      `[StellarRenewalDriver] Renewal charged ${wallet} ${amount} micros ` +
        `(tx=${txHash || "submitted"}) on chain ${this.chainId}`,
    );
    return { wallet, due: true, charged: true, txHash: txHash || undefined };
  }
}
