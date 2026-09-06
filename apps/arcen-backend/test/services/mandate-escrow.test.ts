import { describe, expect, it } from "vitest";
import { MandateService } from "../../src/services/mandate.service.js";
import { EscrowService } from "../../src/services/escrow.service.js";
import type { ArcenPayAgentMandate, SettlementConfirmation, DisputeClaim } from "@arcenpay/internal-core";

describe("MandateService", () => {
  it("returns active status for an unrevoked mandate", () => {
    const service = new MandateService();
    const status = service.getMandateStatus("mandate_001");
    expect(status.status).toBe("active");
    expect(status.mandateId).toBe("mandate_001");
    expect(service.isRevoked("mandate_001")).toBe(false);
  });

  it("revokes a mandate and reports revoked status with reason", () => {
    const service = new MandateService();
    const record = service.revokeMandate("mandate_002", "Security compromised", "0xAdmin");
    expect(record.mandateId).toBe("mandate_002");
    expect(record.reason).toBe("Security compromised");
    expect(record.revokedBy).toBe("0xAdmin");
    expect(record.revokedAt).toBeTruthy();

    expect(service.isRevoked("mandate_002")).toBe(true);

    const status = service.getMandateStatus("mandate_002");
    expect(status.status).toBe("revoked");
    expect(status.revokedAt).toBe(record.revokedAt);
  });

  it("detects expired registered mandates", () => {
    const service = new MandateService();
    const expiredMandate: ArcenPayAgentMandate = {
      type: "ArcenPayAgentMandate",
      mandateId: "mandate_expired",
      version: "1.0",
      issuer: { kind: "human_wallet", address: "0xIssuer", chainId: 8453 },
      subject: { kind: "agent", agentId: "agent-1", publicKey: "0xSubject" },
      scope: {
        maxPerTxn: "1.00",
        maxDaily: "10.00",
        allowedTokens: ["USDC"],
        allowedRecipients: ["*"],
        validFrom: new Date(Date.now() - 200000).toISOString(),
        validUntil: new Date(Date.now() - 100000).toISOString(), // expired
      },
      revocation: { method: "offchain_endpoint", checkUrl: "https://api.arcenpay.xyz" },
      signature: "0xsignature",
      issuedAt: new Date().toISOString(),
    };

    service.registerMandate(expiredMandate);
    const status = service.getMandateStatus("mandate_expired");
    expect(status.status).toBe("expired");
  });
});

describe("EscrowService", () => {
  it("creates an escrow reservation with default challenge window", () => {
    const service = new EscrowService();
    const reservation = service.createReservation({
      requestNonce: "req_001",
      payerWallet: "0xPayer",
      recipientWallet: "0xRecipient",
      amount: "5.000000",
      amountAtomic: "5000000",
      tokenAddress: "0xUSDC",
      chainId: 8453,
      mode: "exact_hash",
    });

    expect(reservation.id).toMatch(/^esc_/);
    expect(reservation.status).toBe("reserved");
    expect(reservation.challengeWindowSeconds).toBe(300);
    expect(reservation.requestNonce).toBe("req_001");

    const status = service.getStatus("req_001");
    expect(status.status).toBe("reserved");
    expect(status.reservation?.amount).toBe("5.000000");
  });

  it("confirms and releases a reservation", () => {
    const service = new EscrowService();
    service.createReservation({
      requestNonce: "req_002",
      payerWallet: "0xPayer",
      recipientWallet: "0xRecipient",
      amount: "2.000000",
      amountAtomic: "2000000",
      tokenAddress: "0xUSDC",
      chainId: 8453,
      mode: "schema_conformance",
    });

    const confirmation: SettlementConfirmation = {
      type: "ArcenSettlementConfirmation",
      requestNonce: "req_002",
      buyerSignature: "0xbuyersig",
      settlementAction: "RELEASE",
      confirmedAt: new Date().toISOString(),
    };

    const res = service.confirmReservation(confirmation);
    expect(res.confirmed).toBe(true);
    expect(res.reservation?.status).toBe("released");
    expect(res.reservation?.confirmation?.settlementAction).toBe("RELEASE");

    const status = service.getStatus("req_002");
    expect(status.status).toBe("released");
  });

  it("handles a dispute and returns an automated refund receipt", () => {
    const service = new EscrowService();
    service.createReservation({
      requestNonce: "req_003",
      payerWallet: "0xPayer",
      recipientWallet: "0xRecipient",
      amount: "10.000000",
      amountAtomic: "10000000",
      tokenAddress: "0xUSDC",
      chainId: 8453,
      mode: "exact_hash",
    });

    const claim: DisputeClaim = {
      type: "ArcenDisputeClaim",
      requestNonce: "req_003",
      failureReason: "hash_mismatch",
      actualPayloadHash: "0xbadhash",
      claimTimestamp: new Date().toISOString(),
    };

    const receipt = service.disputeReservation(claim);
    expect(receipt.outcome).toBe("refunded");
    expect(receipt.refundedAmount).toBe("10.000000");
    expect(receipt.reason).toContain("hash_mismatch");

    const status = service.getStatus("req_003");
    expect(status.status).toBe("refunded");
  });

  it("returns released status for unknown nonces", () => {
    const service = new EscrowService();
    const status = service.getStatus("unknown_nonce");
    expect(status.status).toBe("released");
    expect(status.reservation).toBeUndefined();
  });
});
