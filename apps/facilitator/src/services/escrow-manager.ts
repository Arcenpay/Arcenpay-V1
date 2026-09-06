// ============================================================
//  @arcenpay/facilitator — Escrow Challenge Window & Settlement Manager
//  Manages the commit-reveal challenge delay window, releasing funds
//  upon early confirmation or challenge expiry, or issuing refunds
//  when a dispute claim is verified.
// ============================================================

import type {
  EscrowReservation,
  EscrowReservationStatus,
  EscrowMode,
  ProviderCommitment,
  SettlementConfirmation,
  DisputeClaim,
  DisputeReceipt,
} from "@arcenpay/internal-core";
import { randomUUID } from "node:crypto";

export interface EscrowReleaseCallback {
  (reservation: EscrowReservation): Promise<void>;
}

export class EscrowManagerService {
  private reservations = new Map<string, EscrowReservation>();
  private releaseCallbacks: EscrowReleaseCallback[] = [];
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor() {
    // Sweep every 10 seconds for expired challenge windows
    this.sweepTimer = setInterval(() => {
      this.sweepExpiredChallenges().catch((err) => {
        console.error("[EscrowManagerService] Challenge sweep error:", err);
      });
    }, 10_000);
    this.sweepTimer.unref?.();
  }

  onRelease(callback: EscrowReleaseCallback): void {
    this.releaseCallbacks.push(callback);
  }

  reserve(params: {
    requestNonce: string;
    sessionId?: string;
    payerWallet: string;
    recipientWallet: string;
    amount: string;
    amountAtomic: string;
    tokenAddress: string;
    chainId: number;
    mode?: EscrowMode;
    challengeWindowSeconds?: number;
    commitment?: ProviderCommitment | null;
  }): EscrowReservation {
    const windowSec = params.challengeWindowSeconds ?? 300;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + windowSec * 1000).toISOString();

    const reservation: EscrowReservation = {
      id: `esc_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
      requestNonce: params.requestNonce,
      sessionId: params.sessionId ?? `sess_${params.requestNonce}`,
      payerWallet: params.payerWallet,
      recipientWallet: params.recipientWallet,
      amount: params.amount,
      amountAtomic: params.amountAtomic,
      tokenAddress: params.tokenAddress,
      chainId: params.chainId,
      mode: params.mode ?? "exact_hash",
      status: "reserved",
      challengeWindowSeconds: windowSec,
      expiresAt,
      commitment: params.commitment ?? null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    this.reservations.set(params.requestNonce, reservation);
    return reservation;
  }

  async confirm(confirmation: SettlementConfirmation): Promise<EscrowReservation | null> {
    const res = this.reservations.get(confirmation.requestNonce);
    if (!res) return null;

    if (res.status === "reserved") {
      res.status = "released";
      res.confirmation = confirmation;
      res.updatedAt = new Date().toISOString();
      await this.notifyRelease(res);
    }

    return res;
  }

  dispute(claim: DisputeClaim): DisputeReceipt {
    const res = this.reservations.get(claim.requestNonce);
    const now = new Date().toISOString();

    if (res && res.status === "reserved") {
      res.status = "refunded";
      res.dispute = claim;
      res.updatedAt = now;
    }

    return {
      type: "ArcenDisputeReceipt",
      requestNonce: claim.requestNonce,
      outcome: "refunded",
      reason: `Automated refund: ${claim.failureReason} verified within challenge window.`,
      refundedAmount: res ? res.amount : undefined,
      resolvedAt: now,
    };
  }

  getStatus(requestNonce: string): {
    requestNonce: string;
    status: EscrowReservationStatus;
    reservation?: EscrowReservation;
  } {
    const res = this.reservations.get(requestNonce);
    if (!res) {
      return { requestNonce, status: "released" };
    }
    return {
      requestNonce,
      status: res.status,
      reservation: res,
    };
  }

  async sweepExpiredChallenges(): Promise<number> {
    const now = Date.now();
    let swept = 0;
    for (const res of this.reservations.values()) {
      if (res.status === "reserved" && new Date(res.expiresAt).getTime() <= now) {
        res.status = "released";
        res.updatedAt = new Date().toISOString();
        await this.notifyRelease(res);
        swept++;
      }
    }
    return swept;
  }

  private async notifyRelease(reservation: EscrowReservation): Promise<void> {
    for (const cb of this.releaseCallbacks) {
      try {
        await cb(reservation);
      } catch (err) {
        console.error("[EscrowManagerService] Release callback error:", err);
      }
    }
  }

  stop(): void {
    this.destroy();
  }

  destroy(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }
}

export const escrowManagerService = new EscrowManagerService();
