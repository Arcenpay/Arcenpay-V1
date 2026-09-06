// ============================================================
//  @arcenpay/facilitator — Authoritative Tier-2 Policy Authorizer
//  Evaluates ArcenPolicy rules, mandate limits, velocity windows,
//  and consensus requirements for agent transaction vouchers.
// ============================================================

import type {
  ArcenPolicy,
  PolicyEvaluationContext,
  PolicyEvaluationResult,
  ArcenPayAgentMandate,
} from "@arcenpay/internal-core";

export class PolicyAuthorizerService {
  private agentPolicies = new Map<string, ArcenPolicy[]>();
  private dailySpendTracker = new Map<string, { total: number; resetAt: number }>();

  /**
   * Registers or updates active policies for a given agent or team
   */
  setPolicies(agentId: string, policies: ArcenPolicy[]): void {
    this.agentPolicies.set(agentId.toLowerCase(), policies);
  }

  getPolicies(agentId: string): ArcenPolicy[] {
    return this.agentPolicies.get(agentId.toLowerCase()) ?? [];
  }

  /**
   * Evaluates whether a proposed transaction complies with authoritative off-chain policies
   */
  authorizeTransaction(
    context: PolicyEvaluationContext,
    mandate?: ArcenPayAgentMandate | null,
  ): PolicyEvaluationResult {
    // 1. Root authority direct co-signature bypass (Tier 2 Rule 1)
    if (context.coSigned) {
      return {
        outcome: "OUTCOME_ALLOW",
        reason: "Root co-sign present: authorized by root authority / mandate issuer.",
      };
    }

    // 2. Mandate Scope Hard-Check if mandate is provided
    if (mandate) {
      const scope = mandate.scope;
      const txAmount = Number(context.tx.amount);

      // Check maxPerTxn
      if (scope.maxPerTxn && txAmount > Number(scope.maxPerTxn)) {
        return {
          outcome: "OUTCOME_DENY",
          reason: `Transaction amount ${txAmount} exceeds mandate maxPerTxn limit of ${scope.maxPerTxn}`,
        };
      }

      // Check allowed tokens
      if (scope.allowedTokens && scope.allowedTokens.length > 0) {
        const allowed = scope.allowedTokens.map((t) => t.toUpperCase());
        if (!allowed.includes(context.tx.token.toUpperCase())) {
          return {
            outcome: "OUTCOME_DENY",
            reason: `Token "${context.tx.token}" is not permitted by mandate (allowed: ${allowed.join(", ")})`,
          };
        }
      }

      // Check allowed recipients
      if (scope.allowedRecipients && !scope.allowedRecipients.includes("*")) {
        const allowedRecipients = scope.allowedRecipients.map((r) => r.toLowerCase());
        if (!allowedRecipients.includes(context.tx.recipient.toLowerCase())) {
          return {
            outcome: "OUTCOME_DENY",
            reason: `Recipient "${context.tx.recipient}" is not permitted by mandate allowedRecipients`,
          };
        }
      }

      // Check denied recipients
      if (scope.deniedRecipients && scope.deniedRecipients.length > 0) {
        const deniedRecipients = scope.deniedRecipients.map((r) => r.toLowerCase());
        if (deniedRecipients.includes(context.tx.recipient.toLowerCase())) {
          return {
            outcome: "OUTCOME_DENY",
            reason: `Recipient "${context.tx.recipient}" is explicitly denied by mandate`,
          };
        }
      }

      // Check allowed resource domains
      if (
        scope.allowedResourceDomains &&
        scope.allowedResourceDomains.length > 0 &&
        !scope.allowedResourceDomains.includes("*")
      ) {
        const domain = context.resource?.domain?.toLowerCase();
        if (domain) {
          const allowedDomains = scope.allowedResourceDomains.map((d) => d.toLowerCase());
          const isAllowed = allowedDomains.some((d) => {
            if (d.startsWith("*.")) {
              const root = d.slice(2);
              return domain === root || domain.endsWith("." + root);
            }
            return domain === d;
          });
          if (!isAllowed) {
            return {
              outcome: "OUTCOME_DENY",
              reason: `Domain ${context.resource?.domain} not permitted by mandate allowedResourceDomains`,
            };
          }
        }
      }

      // Check validity timeframe
      const now = context.timestamp ?? Date.now();
      if (scope.validFrom && now < new Date(scope.validFrom).getTime()) {
        return {
          outcome: "OUTCOME_DENY",
          reason: `Mandate is not active yet (validFrom: ${scope.validFrom})`,
        };
      }
      if (scope.validUntil && now > new Date(scope.validUntil).getTime()) {
        return {
          outcome: "OUTCOME_DENY",
          reason: `Mandate has expired (validUntil: ${scope.validUntil})`,
        };
      }

      // Check velocity daily limits
      const dailySpent = this.getDailySpent(context.agentId);
      if (scope.maxDaily && dailySpent + txAmount > Number(scope.maxDaily)) {
        return {
          outcome: "OUTCOME_DENY",
          reason: `Cumulative daily spend (${dailySpent + txAmount}) would exceed mandate maxDaily limit of ${scope.maxDaily}`,
        };
      }
    }

    // 3. ArcenPolicy evaluation
    const policies = context.agentId ? (this.agentPolicies.get(context.agentId.toLowerCase()) ?? []) : [];
    if (policies.length === 0) {
      // If no custom policies configured and mandate passed (or absent), allow within default limits
      return {
        outcome: "OUTCOME_ALLOW",
        reason: "Compliant with baseline authorization rules.",
      };
    }

    const applicable = policies
      .filter((policy) => {
        if (!policy.appliesTo) return true;
        if (policy.appliesTo.agentId && policy.appliesTo.agentId !== context.agentId) return false;
        if (policy.appliesTo.mandateId && context.mandateId && policy.appliesTo.mandateId !== context.mandateId) {
          return false;
        }
        return true;
      })
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

    // Explicit Deny
    for (const policy of applicable) {
      if (policy.effect === "EFFECT_DENY") {
        if (this.evaluateSimpleCondition(policy.condition, context)) {
          return {
            outcome: "OUTCOME_DENY",
            matchedPolicyId: policy.policyId,
            reason: `Explicit deny policy "${policy.name ?? policy.policyId}" matched.`,
          };
        }
      }
    }

    // Explicit Allow
    for (const policy of applicable) {
      if (policy.effect === "EFFECT_ALLOW") {
        if (this.evaluateSimpleCondition(policy.condition, context)) {
          const requiresCoSign = Boolean(policy.consensus?.includes("cosign"));
          return {
            outcome: "OUTCOME_ALLOW",
            matchedPolicyId: policy.policyId,
            requiresCoSign,
            consensusRequired: policy.consensus,
            reason: `Allow policy "${policy.name ?? policy.policyId}" matched.`,
          };
        }
      }
    }

    // Default Deny
    return {
      outcome: "OUTCOME_DENY",
      reason: "Implicit deny: no allow policy matched transaction conditions (Default Deny).",
    };
  }

  recordSpend(agentId?: string, amount: number = 0): void {
    if (!agentId) return;
    const key = agentId.toLowerCase();
    const now = Date.now();
    const current = this.dailySpendTracker.get(key);

    if (!current || now >= current.resetAt) {
      const resetAt = new Date().setHours(24, 0, 0, 0);
      this.dailySpendTracker.set(key, { total: amount, resetAt });
    } else {
      current.total += amount;
    }
  }

  getDailySpent(agentId?: string): number {
    if (!agentId) return 0;
    const key = agentId.toLowerCase();
    const current = this.dailySpendTracker.get(key);
    if (!current || Date.now() >= current.resetAt) {
      return 0;
    }
    return current.total;
  }

  private evaluateSimpleCondition(condition: string, ctx: PolicyEvaluationContext): boolean {
    const trimmed = condition.trim();
    if (!trimmed || trimmed === "true") return true;
    if (trimmed === "false") return false;

    // Split on &&
    const clauses = trimmed.split("&&").map((c) => c.trim());
    return clauses.every((clause) => {
      const match = clause.match(/^(.+?)\s*(<=|>=|<|>|==|!=)\s*(.+)$/);
      if (!match) return true;
      const leftExpr = match[1].trim();
      const op = match[2];
      const rightVal = match[3].trim().replace(/^['"]|['"]$/g, "");

      let leftVal: any = 0;
      if (leftExpr === "tx.amount") leftVal = Number(ctx.tx.amount);
      else if (leftExpr === "tx.token") leftVal = ctx.tx.token;
      else if (leftExpr === "resource.domain") leftVal = ctx.resource?.domain ?? "";

      const rightNum = Number(rightVal);
      if (!isNaN(Number(leftVal)) && !isNaN(rightNum)) {
        const l = Number(leftVal);
        switch (op) {
          case "<=": return l <= rightNum;
          case ">=": return l >= rightNum;
          case "<": return l < rightNum;
          case ">": return l > rightNum;
          case "==": return l === rightNum;
          case "!=": return l !== rightNum;
        }
      }

      switch (op) {
        case "==": return String(leftVal).toLowerCase() === rightVal.toLowerCase();
        case "!=": return String(leftVal).toLowerCase() !== rightVal.toLowerCase();
        default: return false;
      }
    });
  }
}

export const policyAuthorizerService = new PolicyAuthorizerService();
