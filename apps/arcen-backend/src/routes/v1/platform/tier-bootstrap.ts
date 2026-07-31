import type { Context } from "hono";
import { bootstrapPlatformBillingPlans } from "../../../lib/billing/platform-tier-billing.js";
import { isErrorResponse } from "../../../lib/auth/api-auth.js";
import { requirePlatformOwner } from "../../../lib/auth/platform-owner.js";
import { writeAuditEvent } from "../../../lib/platform/audit.js";

/**
 * POST /api/v1/platform/tier/bootstrap
 *
 * Owner-only endpoint that uses the backend ops signer to create
 * the PLUS and PRO platform billing plans on Arc testnet via PlanFactory.
 *
 * Idempotent: if plans already exist and match config, they are reused.
 * Fails visibly if an existing plan has a parameter mismatch.
 */
export async function postTierBootstrap(c: Context) {
  const auth = await requirePlatformOwner(c);
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any);

  try {
    const result = await bootstrapPlatformBillingPlans();

    await writeAuditEvent({
      headers: c.req.raw.headers,
      teamId: auth.team.teamId,
      userId: auth.team.userId,
      walletAddress: auth.team.walletAddress,
      action: "platform.billing.bootstrap",
      resourceType: "PlatformBillingPlan",
      resourceId: String(result.chainId),
      afterData: { chainId: result.chainId, plans: result.plans },
    });

    return c.json({ ok: true, chainId: result.chainId, plans: result.plans });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[platform/tier/bootstrap] Bootstrap failed:", message);
    return c.json({ ok: false, error: "Bootstrap failed", message }, 500 as any);
  }
}
