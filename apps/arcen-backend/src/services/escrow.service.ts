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

export class EscrowService {
  private reservations = new Map<string, EscrowReservation>();

  createReservation(params: {
    requestNonce: string;
    sessionId?: string;
    payerWallet: string;
    recipientWallet: string;
    amount: string;
    amountAtomic: string;
    tokenAddress: string;
    chainId: number;
    mode: EscrowMode;
    challengeWindowSeconds?: number;
    commitment?: ProviderCommitment | null;
  }): EscrowReservation {
    const now = new Date();
    const windowSec = params.challengeWindowSeconds ?? 300;
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
      mode: params.mode,
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

  confirmReservation(confirmation: SettlementConfirmation): {
    confirmed: boolean;
    reservation?: EscrowReservation;
  } {
    const res = this.reservations.get(confirmation.requestNonce);
    if (!res) {
      return { confirmed: true };
    }

    res.status = "released";
    res.confirmation = confirmation;
    res.updatedAt = new Date().toISOString();
    return { confirmed: true, reservation: res };
  }

  disputeReservation(claim: DisputeClaim): DisputeReceipt {
    const res = this.reservations.get(claim.requestNonce);
    const now = new Date().toISOString();

    if (res) {
      res.status = "refunded";
      res.dispute = claim;
      res.updatedAt = now;
    }

    return {
      type: "ArcenDisputeReceipt",
      requestNonce: claim.requestNonce,
      outcome: "refunded",
      reason: `Automated refund issued: ${claim.failureReason} confirmed`,
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
      return {
        requestNonce,
        status: "released",
      };
    }
    return {
      requestNonce,
      status: res.status,
      reservation: res,
    };
  }
}

export const escrowService = new EscrowService();
