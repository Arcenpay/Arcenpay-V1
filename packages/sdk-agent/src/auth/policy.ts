// ============================================================
//  @arcenpay/agent — ArcenPolicy Rules Engine (Layer 2)
//  Deterministic condition evaluation for velocity, allowlists,
//  domain restrictions, and consensus co-signing gates.
// ============================================================

import type {
  ArcenPolicy,
  PolicyEvaluationContext,
  PolicyEvaluationResult,
} from "../internal/core";

/**
 * Evaluates whether a domain matches a pattern with optional wildcard (e.g. "*.arcenpay.xyz").
 */
export function matchDomain(domain: string, pattern: string): boolean {
  const d = domain.trim().toLowerCase();
  const p = pattern.trim().toLowerCase();
  if (p === "*" || d === p) return true;
  if (p.startsWith("*.")) {
    const root = p.slice(2);
    return d === root || d.endsWith(`.${root}`);
  }
  return false;
}

/**
 * Sandboxed, safe predicate evaluator for ArcenPolicy conditions.
 * Supports logical AND (&&), logical OR (||), comparisons (<=, >=, <, >, ==, !=),
 * and set membership (in [...], not in [...]).
 */
export function evaluateCondition(condition: string, context: PolicyEvaluationContext): boolean {
  const trimmed = condition.trim();
  if (!trimmed || trimmed === "true") return true;
  if (trimmed === "false") return false;

  // Split clauses by '||' (lowest precedence)
  const orClauses = splitRespectingQuotes(trimmed, "||");
  if (orClauses.length > 1) {
    return orClauses.some((clause) => evaluateCondition(clause, context));
  }

  // Split clauses by '&&'
  const andClauses = splitRespectingQuotes(trimmed, "&&");
  if (andClauses.length > 1) {
    return andClauses.every((clause) => evaluateCondition(clause, context));
  }

  return evaluateAtomicPredicate(trimmed, context);
}

function splitRespectingQuotes(str: string, delimiter: string): string[] {
  const result: string[] = [];
  let depth = 0;
  let inQuote: string | null = null;
  let current = "";

  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (inQuote) {
      current += char;
      if (char === inQuote && str[i - 1] !== "\\") {
        inQuote = null;
      }
    } else if (char === "'" || char === '"') {
      inQuote = char;
      current += char;
    } else if (char === "[" || char === "(") {
      depth++;
      current += char;
    } else if (char === "]" || char === ")") {
      depth--;
      current += char;
    } else if (depth === 0 && str.startsWith(delimiter, i)) {
      result.push(current.trim());
      current = "";
      i += delimiter.length - 1;
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    result.push(current.trim());
  }

  return result;
}

function evaluateAtomicPredicate(predicate: string, ctx: PolicyEvaluationContext): boolean {
  const p = predicate.trim();
  if (p.startsWith("!")) {
    return !evaluateAtomicPredicate(p.slice(1).trim(), ctx);
  }

  // Pattern: "A not in B"
  const notInMatch = p.match(/^(.+?)\s+not\s+in\s+\[(.*)\]$/i);
  if (notInMatch) {
    const leftVal = resolveField(notInMatch[1].trim(), ctx);
    const list = parseList(notInMatch[2]);
    return !isItemInList(leftVal, list);
  }

  // Pattern: "A in B"
  const inMatch = p.match(/^(.+?)\s+in\s+\[(.*)\]$/i);
  if (inMatch) {
    const leftVal = resolveField(inMatch[1].trim(), ctx);
    const list = parseList(inMatch[2]);
    return isItemInList(leftVal, list);
  }

  // Comparisons: <=, >=, !=, ==, <, >
  const opMatch = p.match(/^(.+?)\s*(<=|>=|!=|==|<|>)\s*(.+)$/);
  if (opMatch) {
    const leftVal = resolveField(opMatch[1].trim(), ctx);
    const op = opMatch[2];
    const rightVal = resolveFieldOrLiteral(opMatch[3].trim(), ctx);

    const leftNum = typeof leftVal === "number" ? leftVal : Number(leftVal);
    const rightNum = typeof rightVal === "number" ? rightVal : Number(rightVal);

    if (!isNaN(leftNum) && !isNaN(rightNum)) {
      switch (op) {
        case "<=": return leftNum <= rightNum;
        case ">=": return leftNum >= rightNum;
        case "<": return leftNum < rightNum;
        case ">": return leftNum > rightNum;
        case "==": return leftNum === rightNum;
        case "!=": return leftNum !== rightNum;
      }
    }

    const leftStr = String(leftVal ?? "").toLowerCase();
    const rightStr = String(rightVal ?? "").toLowerCase();

    switch (op) {
      case "==": return leftStr === rightStr;
      case "!=": return leftStr !== rightStr;
      default: return false;
    }
  }

  return Boolean(resolveField(p, ctx));
}

function resolveField(fieldExpr: string, ctx: PolicyEvaluationContext): any {
  const clean = fieldExpr.trim();

  // Arithmetic: A + B (e.g. tx.dailySpent + tx.amount)
  if (clean.includes("+")) {
    const parts = clean.split("+").map((s) => s.trim());
    return parts.reduce((acc, part) => {
      const v = Number(resolveField(part, ctx));
      return acc + (isNaN(v) ? 0 : v);
    }, 0);
  }

  switch (clean) {
    case "tx.amount":
      return typeof ctx.tx.amount === "string" ? Number(ctx.tx.amount) : ctx.tx.amount;
    case "tx.amountAtomic":
      return ctx.tx.amountAtomic;
    case "tx.token":
      return ctx.tx.token;
    case "tx.recipient":
      return ctx.tx.recipient;
    case "tx.chainId":
      return ctx.tx.chainId;
    case "tx.dailySpent":
    case "dailySpent":
      return Number(ctx.dailySpent ?? 0);
    case "resource.domain":
      return ctx.resource?.domain ?? "";
    case "resource.url":
      return ctx.resource?.url ?? "";
    case "resource.method":
      return ctx.resource?.method?.toUpperCase() ?? "GET";
    case "agentId":
      return ctx.agentId;
    case "mandateId":
      return ctx.mandateId ?? "";
    case "coSigned":
      return ctx.coSigned ?? false;
    default:
      return resolveLiteral(clean);
  }
}

function resolveLiteral(val: string): any {
  const unquoted = val.replace(/^['"]|['"]$/g, "");
  if (!isNaN(Number(unquoted)) && val.trim() !== "") {
    return Number(unquoted);
  }
  if (unquoted === "true") return true;
  if (unquoted === "false") return false;
  return unquoted;
}

function resolveFieldOrLiteral(expr: string, ctx: PolicyEvaluationContext): any {
  if (expr.startsWith("tx.") || expr.startsWith("resource.")) {
    return resolveField(expr, ctx);
  }
  return resolveLiteral(expr);
}

function parseList(listStr: string): string[] {
  return listStr
    .split(",")
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ""))
    .filter((s) => s.length > 0);
}

function isItemInList(item: any, list: string[]): boolean {
  const itemStr = String(item ?? "").toLowerCase();
  for (const pattern of list) {
    const pStr = pattern.toLowerCase();
    if (pattern.includes("*")) {
      if (matchDomain(itemStr, pattern)) return true;
    } else if (itemStr === pStr) {
      return true;
    }
  }
  return false;
}

/**
 * Evaluates a policy collection against an evaluation context.
 *
 * Evaluation Order (Turnkey-aligned):
 * 1. Root authority direct co-signature -> OUTCOME_ALLOW.
 * 2. If ANY applicable policy evaluates to true with EFFECT_DENY -> OUTCOME_DENY (explicit deny wins).
 * 3. If AT LEAST ONE applicable policy evaluates to true with EFFECT_ALLOW -> OUTCOME_ALLOW.
 * 4. Fallback -> OUTCOME_DENY (implicit deny by default).
 */
export class ArcenPolicyEvaluator {
  private policies: ArcenPolicy[] = [];

  constructor(initialPolicies?: ArcenPolicy[]) {
    if (initialPolicies) {
      this.policies = [...initialPolicies];
    }
  }

  addPolicy(policy: ArcenPolicy): void {
    this.policies.push(policy);
  }

  setPolicies(policies: ArcenPolicy[]): void {
    this.policies = [...policies];
  }

  getPolicies(): ArcenPolicy[] {
    return [...this.policies];
  }

  evaluate(context: PolicyEvaluationContext): PolicyEvaluationResult {
    // 1. Root authority direct co-signature bypass
    if (context.coSigned) {
      return {
        outcome: "OUTCOME_ALLOW",
        reason: "Root co-sign present: direct co-signature by root authority / mandate issuer.",
      };
    }

    // Filter applicable policies
    const applicable = this.policies
      .filter((policy) => {
        if (!policy.appliesTo) return true;
        if (policy.appliesTo.agentId && policy.appliesTo.agentId !== context.agentId) {
          return false;
        }
        if (
          policy.appliesTo.mandateId &&
          context.mandateId &&
          policy.appliesTo.mandateId !== context.mandateId
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

    // If no policies configured at all, fallback to deny
    if (applicable.length === 0) {
      return {
        outcome: "OUTCOME_DENY",
        reason: "Implicit deny: no applicable policies configured for agent (Default Deny).",
      };
    }

    // 2. Explicit Deny Check (Any matching EFFECT_DENY immediately rejects)
    for (const policy of applicable) {
      if (policy.effect === "EFFECT_DENY") {
        const matches = evaluateCondition(policy.condition, context);
        if (matches) {
          return {
            outcome: "OUTCOME_DENY",
            matchedPolicyId: policy.policyId,
            reason: `Explicit deny policy "${policy.name ?? policy.policyId}" matched.`,
          };
        }
      }
    }

    // 3. Explicit Allow Check
    for (const policy of applicable) {
      if (policy.effect === "EFFECT_ALLOW") {
        const matches = evaluateCondition(policy.condition, context);
        if (matches) {
          // Check consensus requirement
          const requiresCoSign =
            policy.consensus?.includes("cosign") ||
            policy.consensus?.includes("require_approval");

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

    // 4. Default Deny
    return {
      outcome: "OUTCOME_DENY",
      reason: "Implicit deny: no allow policy matched transaction conditions (Default Deny).",
    };
  }
}
