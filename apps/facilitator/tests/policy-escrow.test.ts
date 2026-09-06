import test from "node:test";
import assert from "node:assert/strict";
import { PolicyAuthorizerService } from "../src/services/policy-authorizer.js";
import { EscrowManagerService } from "../src/services/escrow-manager.js";
import type {
  ArcenPolicy,
  ArcenPayAgentMandate,
  PolicyEvaluationContext,
  SettlementConfirmation,
  DisputeClaim,
} from "@arcenpay/internal-core";

test("PolicyAuthorizerService allows co-signed transactions unconditionally", () => {
  const authorizer = new PolicyAuthorizerService();
  const context: PolicyEvaluationContext = {
    agentId: "agent_root",
    tx: {
      amount: "500.00",
      amountAtomic: 500000000n,
      token: "USDC",
      recipient: "0xRecipient",
      chainId: 8453,
    },
    coSigned: true,
  };

  const result = authorizer.authorizeTransaction(context);
  assert.equal(result.outcome, "OUTCOME_ALLOW");
  assert.match(result.reason ?? "", /Root co-sign present/);
});

test("PolicyAuthorizerService enforces mandate scope constraints", () => {
  const authorizer = new PolicyAuthorizerService();
  const mandate: ArcenPayAgentMandate = {
    type: "ArcenPayAgentMandate",
    mandateId: "mandate_scope_test",
    version: "1.0",
    issuer: { kind: "parent_agent", address: "0xIssuer", chainId: 8453 },
    subject: { kind: "agent", agentId: "worker-1", publicKey: "0xWorker" },
    scope: {
      maxPerTxn: "10.00",
      maxDaily: "50.00",
      allowedTokens: ["USDC"],
      allowedRecipients: ["0xMerchant"],
      allowedResourceDomains: ["api.coingecko.com"],
      validFrom: new Date(Date.now() - 1000).toISOString(),
      validUntil: new Date(Date.now() + 100000).toISOString(),
    },
    revocation: { method: "onchain_registry", registryAddress: "0xRegistry" },
    signature: "0xsig",
    issuedAt: new Date().toISOString(),
  };

  // Exceeds maxPerTxn
  const overAmountCtx: PolicyEvaluationContext = {
    agentId: "worker-1",
    tx: {
      amount: "15.00",
      amountAtomic: 15000000n,
      token: "USDC",
      recipient: "0xMerchant",
      chainId: 8453,
    },
  };
  const res1 = authorizer.authorizeTransaction(overAmountCtx, mandate);
  assert.equal(res1.outcome, "OUTCOME_DENY");
  assert.match(res1.reason ?? "", /maxPerTxn limit/);

  // Disallowed token
  const badTokenCtx: PolicyEvaluationContext = {
    agentId: "worker-1",
    tx: {
      amount: "5.00",
      amountAtomic: 5000000n,
      token: "DAI",
      recipient: "0xMerchant",
      chainId: 8453,
    },
  };
  const res2 = authorizer.authorizeTransaction(badTokenCtx, mandate);
  assert.equal(res2.outcome, "OUTCOME_DENY");
  assert.match(res2.reason ?? "", /not permitted by mandate/);

  // Disallowed recipient
  const badRecipientCtx: PolicyEvaluationContext = {
    agentId: "worker-1",
    tx: {
      amount: "5.00",
      amountAtomic: 5000000n,
      token: "USDC",
      recipient: "0xOtherRecipient",
      chainId: 8453,
    },
  };
  const res3 = authorizer.authorizeTransaction(badRecipientCtx, mandate);
  assert.equal(res3.outcome, "OUTCOME_DENY");
  assert.match(res3.reason ?? "", /Recipient .* not permitted/);

  // Disallowed domain
  const badDomainCtx: PolicyEvaluationContext = {
    agentId: "worker-1",
    tx: {
      amount: "5.00",
      amountAtomic: 5000000n,
      token: "USDC",
      recipient: "0xMerchant",
      chainId: 8453,
    },
    resource: { domain: "malicious.com", url: "https://malicious.com/api" },
  };
  const res4 = authorizer.authorizeTransaction(badDomainCtx, mandate);
  assert.equal(res4.outcome, "OUTCOME_DENY");
  assert.match(res4.reason ?? "", /Domain malicious.com not permitted/);
});

test("PolicyAuthorizerService evaluates Turnkey-style policy rules", () => {
  const authorizer = new PolicyAuthorizerService();
  const agentId = "0xAgent007";

  const policies: ArcenPolicy[] = [
    {
      policyId: "deny-large-spends",
      name: "Deny Large Spends",
      effect: "EFFECT_DENY",
      condition: "tx.amount > 100.00",
      priority: 200,
    },
    {
      policyId: "allow-small-usdc",
      name: "Allow Small USDC",
      effect: "EFFECT_ALLOW",
      condition: "tx.amount <= 10.00 && tx.token == 'USDC'",
      priority: 100,
    },
  ];

  authorizer.setPolicies(agentId, policies);

  // Deny policy match
  const largeCtx: PolicyEvaluationContext = {
    agentId,
    tx: {
      amount: "150.00",
      amountAtomic: 150000000n,
      token: "USDC",
      recipient: "0xStore",
      chainId: 8453,
    },
  };
  const res1 = authorizer.authorizeTransaction(largeCtx);
  assert.equal(res1.outcome, "OUTCOME_DENY");
  assert.equal(res1.matchedPolicyId, "deny-large-spends");

  // Allow policy match
  const smallCtx: PolicyEvaluationContext = {
    agentId,
    tx: {
      amount: "5.00",
      amountAtomic: 5000000n,
      token: "USDC",
      recipient: "0xStore",
      chainId: 8453,
    },
  };
  const res2 = authorizer.authorizeTransaction(smallCtx);
  assert.equal(res2.outcome, "OUTCOME_ALLOW");
  assert.equal(res2.matchedPolicyId, "allow-small-usdc");

  // Default deny (neither matches: $50 spend)
  const mediumCtx: PolicyEvaluationContext = {
    agentId,
    tx: {
      amount: "50.00",
      amountAtomic: 50000000n,
      token: "USDC",
      recipient: "0xStore",
      chainId: 8453,
    },
  };
  const res3 = authorizer.authorizeTransaction(mediumCtx);
  assert.equal(res3.outcome, "OUTCOME_DENY");
  assert.match(res3.reason ?? "", /Default Deny/);
});

test("EscrowManagerService lifecycle: reserve, confirm, dispute, and auto-sweep", async () => {
  const manager = new EscrowManagerService();
  const releases: string[] = [];

  manager.onRelease(async (res) => {
    releases.push(res.requestNonce);
  });

  // 1. Reserve
  const reservation = manager.reserve({
    requestNonce: "nonce_escrow_1",
    payerWallet: "0xBuyer",
    recipientWallet: "0xSeller",
    amount: "10.000000",
    amountAtomic: "10000000",
    tokenAddress: "0xUSDC",
    chainId: 8453,
    challengeWindowSeconds: 1, // 1 second for test
  });

  assert.equal(reservation.status, "reserved");
  assert.equal(manager.getStatus("nonce_escrow_1").status, "reserved");

  // 2. Early Confirmation
  const conf: SettlementConfirmation = {
    type: "ArcenSettlementConfirmation",
    requestNonce: "nonce_escrow_1",
    verifiedCommitment: "0xcommitment",
    result: "match",
    agentSignature: "0xagentsig",
  };

  const confirmRes = await manager.confirm(conf);
  assert.equal(confirmRes?.status, "released");
  assert.equal(manager.getStatus("nonce_escrow_1").status, "released");
  assert.equal(releases.includes("nonce_escrow_1"), true);

  // 3. Dispute Claim
  manager.reserve({
    requestNonce: "nonce_escrow_2",
    payerWallet: "0xBuyer",
    recipientWallet: "0xSeller",
    amount: "25.000000",
    amountAtomic: "25000000",
    tokenAddress: "0xUSDC",
    chainId: 8453,
    challengeWindowSeconds: 300,
  });

  const claim: DisputeClaim = {
    type: "ArcenDisputeClaim",
    requestNonce: "nonce_escrow_2",
    providerCommitment: {
      type: "ArcenProviderCommitment",
      requestNonce: "nonce_escrow_2",
      resourceId: "res_2",
      mode: "exact_hash",
      commitment: "0xexpected",
      timestamp: new Date().toISOString(),
      providerSignature: "0xprovidersig",
    },
    actualPayloadHash: "0xactual",
    failureReason: "hash_mismatch",
    agentSignature: "0xagentsig",
  };

  const disputeReceipt = manager.dispute(claim);
  assert.equal(disputeReceipt.outcome, "refunded");
  assert.equal(disputeReceipt.refundedAmount, "25.000000");
  assert.equal(manager.getStatus("nonce_escrow_2").status, "refunded");

  // 4. Challenge window sweep expiration
  manager.reserve({
    requestNonce: "nonce_escrow_3",
    payerWallet: "0xBuyer",
    recipientWallet: "0xSeller",
    amount: "5.000000",
    amountAtomic: "5000000",
    tokenAddress: "0xUSDC",
    chainId: 8453,
    challengeWindowSeconds: 0, // Immediately expired
  });

  // Manually trigger sweep
  const sweptCount = await manager.sweepExpiredChallenges();
  assert.ok(sweptCount >= 1);
  assert.equal(manager.getStatus("nonce_escrow_3").status, "released");
  assert.equal(releases.includes("nonce_escrow_3"), true);

  manager.stop();
});
