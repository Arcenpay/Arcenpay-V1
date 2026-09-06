import { describe, it, expect } from "vitest";
import {
  matchDomain,
  evaluateCondition,
  ArcenPolicyEvaluator,
  type ArcenPolicy,
  type PolicyEvaluationContext,
} from "../src";

describe("ArcenAuth Policy Engine (Layer 2)", () => {
  describe("matchDomain", () => {
    it("should match exact domains", () => {
      expect(matchDomain("api.openai.com", "api.openai.com")).toBe(true);
      expect(matchDomain("api.openai.com", "api.anthropic.com")).toBe(false);
    });

    it("should match wildcard prefix patterns", () => {
      expect(matchDomain("api.arcenpay.xyz", "*.arcenpay.xyz")).toBe(true);
      expect(matchDomain("checkout.sub.arcenpay.xyz", "*.arcenpay.xyz")).toBe(true);
      expect(matchDomain("arcenpay.xyz", "*.arcenpay.xyz")).toBe(true);
      expect(matchDomain("otherdomain.xyz", "*.arcenpay.xyz")).toBe(false);
    });

    it("should match universal wildcard '*'", () => {
      expect(matchDomain("anything.org", "*")).toBe(true);
    });
  });

  describe("evaluateCondition", () => {
    const context: PolicyEvaluationContext = {
      tx: {
        amount: "2.50",
        amountAtomic: 2500000n,
        token: "USDC",
        recipient: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
        chainId: 84532,
      },
      resource: {
        domain: "api.openai.com",
        url: "https://api.openai.com/v1/chat/completions",
      },
      agentId: "agent-007",
      mandateId: "aam_12345",
      coSigned: false,
      dailySpent: 10.0,
      timestamp: Date.now(),
    };

    it("should evaluate numeric amount comparisons", () => {
      expect(evaluateCondition("tx.amount <= 5.0", context)).toBe(true);
      expect(evaluateCondition("tx.amount > 5.0", context)).toBe(false);
      expect(evaluateCondition("tx.amount == 2.50", context)).toBe(true);
      expect(evaluateCondition("tx.amount + dailySpent <= 15.0", context)).toBe(true);
      expect(evaluateCondition("tx.amount + dailySpent <= 11.0", context)).toBe(false);
    });

    it("should evaluate token and recipient conditions", () => {
      expect(evaluateCondition("tx.token == 'USDC'", context)).toBe(true);
      expect(evaluateCondition("tx.token in ['USDC', 'USDT']", context)).toBe(true);
      expect(evaluateCondition("tx.token in ['ETH']", context)).toBe(false);
    });

    it("should evaluate resource domain conditions", () => {
      expect(evaluateCondition("resource.domain in ['api.openai.com', '*.anthropic.com']", context)).toBe(true);
      expect(evaluateCondition("resource.domain in ['malicious.xyz']", context)).toBe(false);
    });

    it("should evaluate compound logical conditions (&& and ||)", () => {
      expect(evaluateCondition("tx.amount <= 5.0 && tx.token == 'USDC'", context)).toBe(true);
      expect(evaluateCondition("tx.amount > 10.0 || tx.token == 'USDC'", context)).toBe(true);
      expect(evaluateCondition("tx.amount > 10.0 && tx.token == 'USDC'", context)).toBe(false);
    });

    it("should evaluate coSigned flag conditions", () => {
      expect(evaluateCondition("tx.amount > 2.0 && !coSigned", context)).toBe(true);
      expect(evaluateCondition("tx.amount > 2.0 && coSigned", context)).toBe(false);

      const coSignedContext = { ...context, coSigned: true };
      expect(evaluateCondition("tx.amount > 2.0 && coSigned", coSignedContext)).toBe(true);
    });
  });

  describe("ArcenPolicyEvaluator (Turnkey-aligned Precedence)", () => {
    const baseContext: PolicyEvaluationContext = {
      tx: {
        amount: "5.0",
        amountAtomic: 5000000n,
        token: "USDC",
        recipient: "0x1111111111111111111111111111111111111111",
        chainId: 84532,
      },
      resource: {
        domain: "api.openai.com",
        url: "https://api.openai.com/v1/embeddings",
      },
      agentId: "agent-007",
      mandateId: "aam_root",
      coSigned: false,
      dailySpent: 0,
      timestamp: Date.now(),
    };

    it("should allow automatically if Root Co-signed (Bypass Rule)", () => {
      const evaluator = new ArcenPolicyEvaluator([
        {
          policyId: "deny-all",
          effect: "EFFECT_DENY",
          condition: "true",
          priority: 100,
        },
      ]);

      const result = evaluator.evaluate({ ...baseContext, coSigned: true });
      expect(result.outcome).toBe("OUTCOME_ALLOW");
      expect(result.reason).toContain("Root co-sign present");
    });

    it("should enforce Explicit Deny before Explicit Allow (Rule 2 > Rule 3)", () => {
      const evaluator = new ArcenPolicyEvaluator([
        {
          policyId: "allow-under-10",
          name: "Allow sub-10",
          effect: "EFFECT_ALLOW",
          condition: "tx.amount <= 10.0",
          priority: 10,
        },
        {
          policyId: "deny-domain-openai",
          name: "Deny OpenAI",
          effect: "EFFECT_DENY",
          condition: "resource.domain == 'api.openai.com'",
          priority: 5,
        },
      ]);

      const result = evaluator.evaluate(baseContext);
      expect(result.outcome).toBe("OUTCOME_DENY");
      expect(result.matchedPolicyId).toBe("deny-domain-openai");
    });

    it("should enforce Explicit Allow when condition matches and no deny matches", () => {
      const evaluator = new ArcenPolicyEvaluator([
        {
          policyId: "allow-under-10",
          name: "Allow sub-10",
          effect: "EFFECT_ALLOW",
          condition: "tx.amount <= 10.0 && tx.token == 'USDC'",
          priority: 10,
        },
      ]);

      const result = evaluator.evaluate(baseContext);
      expect(result.outcome).toBe("OUTCOME_ALLOW");
      expect(result.matchedPolicyId).toBe("allow-under-10");
    });

    it("should enforce Default Deny when no allow policy matches (Rule 4)", () => {
      const evaluator = new ArcenPolicyEvaluator([
        {
          policyId: "allow-anthropic-only",
          effect: "EFFECT_ALLOW",
          condition: "resource.domain == 'api.anthropic.com'",
          priority: 10,
        },
      ]);

      const result = evaluator.evaluate(baseContext); // target is api.openai.com
      expect(result.outcome).toBe("OUTCOME_DENY");
      expect(result.reason).toContain("Default Deny");
    });

    it("should flag requiresCoSign when policy specifies consensus co-sign", () => {
      const evaluator = new ArcenPolicyEvaluator([
        {
          policyId: "allow-large-with-cosign",
          effect: "EFFECT_ALLOW",
          consensus: "human_cosign",
          condition: "tx.amount <= 10.0",
          priority: 10,
        },
      ]);

      const result = evaluator.evaluate(baseContext);
      expect(result.outcome).toBe("OUTCOME_ALLOW");
      expect(result.requiresCoSign).toBe(true);
      expect(result.consensusRequired).toBe("human_cosign");
    });
  });
});
