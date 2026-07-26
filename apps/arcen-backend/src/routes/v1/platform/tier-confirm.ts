import type { Context } from "hono";
import { z } from "zod";
import { db } from "../../../db.js";
import { confirmPlatformTierActivation } from "../../../lib/billing/platform-tier-billing.js";
import { requireTeamRoles, isErrorResponse } from "../../../lib/auth/api-auth.js";
import { writeAuditEvent } from "../../../lib/platform/audit.js";
import { TIER_PRICING } from "../../../lib/catalog/tier-guard.js";
import type { PlatformTier } from "../../../generated/client/client.js";

const confirmSchema = z.object({
  targetTier: z.enum(["PLUS", "PRO"]),
  paymentAccount: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "paymentAccount must be a valid EVM address"),
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/, "txHash must be a 32-byte hex hash"),
});

/**
 * POST /api/v1/platform/tier/confirm
 *
 * Verifies the submitted ERC7579AutopayModule.execute() transaction on Arc testnet,
 * then activates the team's platform tier by creating invoice, payment, and
 * subscription state records.
 *
 * Rejected if:
 *  - Wrong chain
 *  - Tx failed on-chain
 *  - Calldata doesn't decode to execute(paymentAccount, amount)
 *  - Account or amount mismatch
 *  - txHash already used (duplicate replay)
 *
 * Idempotent: re-submitting the same txHash returns the same active state.
 */
export async function postTierConfirm(c: Context) {
  const auth = await requireTeamRoles(c, ["OWNER"]);
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any);

  const body = await c.req.json().catch(() => ({}));
  const parsed = confirmSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { ok: false, error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      400 as any,
    );
  }

  const { targetTier, paymentAccount, txHash } = parsed.data;
  const teamId = auth.team.teamId;

  // Check current tier — block if already on this or higher tier (idempotency)
  const currentTeam = await db.team.findUnique({
    where: { id: teamId },
    select: { id: true, platformTier: true, tierExpiresAt: true, tierSubscriptionId: true },
  });
  if (!currentTeam) {
    return c.json({ ok: false, error: "Team not found" }, 404 as any);
  }

  const tierOrder: Record<string, number> = { FREE: 0, PLUS: 1, PRO: 2 };
  if (currentTeam.platformTier === targetTier) {
    return c.json({
      ok: true,
      deduped: true,
      team: currentTeam,
      billing: {
        subscriptionStateId: null,
        invoiceId: null,
        paymentId: null,
      },
      message: `Already on ${targetTier} tier.`,
    });
  }

  if (tierOrder[currentTeam.platformTier] > tierOrder[targetTier]) {
    return c.json({
      ok: false,
      error: "Team is already on a higher tier. No upgrade needed.",
    }, 409 as any);
  }

  try {
    const result = await confirmPlatformTierActivation({
      teamId,
      targetTier: targetTier as PlatformTier,
      paymentAccount,
      txHash,
    });

    if (!result.ok) {
      return c.json(
        { ok: false, error: result.error ?? "Confirmation failed" },
        result.deduped ? 409 as any : 400 as any,
      );
    }

    // Update team tier and log history
    const tierExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const updated = await db.team.update({
      where: { id: teamId },
      data: {
        platformTier: targetTier as PlatformTier,
        tierExpiresAt,
        ...(result.subscriptionStateId
          ? { tierSubscriptionId: result.subscriptionStateId }
          : {}),
      },
      select: { id: true, platformTier: true, tierExpiresAt: true, tierSubscriptionId: true },
    });

    await db.tierUpgradeHistory.create({
      data: {
        teamId,
        fromTier: currentTeam.platformTier,
        toTier: targetTier as PlatformTier,
        txHash,
        amountUsd: TIER_PRICING[targetTier as PlatformTier].priceUsdc,
        userId: auth.team.userId,
      },
    });

    await writeAuditEvent({
      headers: c.req.raw.headers,
      teamId,
      userId: auth.team.userId,
      walletAddress: auth.team.walletAddress,
      action: "platform.tier.upgrade",
      resourceType: "Team",
      resourceId: teamId,
      beforeData: { tier: currentTeam.platformTier },
      afterData: {
        tier: targetTier,
        txHash,
        paymentAccount,
        subscriptionStateId: result.subscriptionStateId,
        invoiceId: result.invoiceId,
        deduped: result.deduped,
      },
    });

    return c.json({
      ok: true,
      deduped: result.deduped,
      team: updated,
      billing: {
        subscriptionStateId: result.subscriptionStateId,
        invoiceId: result.invoiceId,
        paymentId: result.paymentId,
      },
      message: result.deduped
        ? `Already on ${targetTier} tier.`
        : `Successfully upgraded to ${targetTier} tier!`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[platform/tier/confirm] Confirmation error:", message);
    return c.json({ ok: false, error: "Confirmation failed", message }, 500 as any);
  }
}
