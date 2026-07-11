import type { Context } from "hono";
import { z } from "zod";
import { preparePlatformTierActivation } from "../../../lib/billing/platform-tier-billing.js";
import { requireTeamRoles, isErrorResponse } from "../../../lib/auth/api-auth.js";
import type { PlatformTier } from "../../../generated/client/client.js";

const prepareSchema = z.object({
  targetTier: z.enum(["PLUS", "PRO"]),
  paymentAccount: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "paymentAccount must be a valid EVM address"),
});

/**
 * POST /api/v1/platform/tier/prepare
 *
 * Returns encoded transaction data for the dashboard to submit to the wallet.
 * The caller should sequentially submit:
 *   1. install  — ERC7579AutopayModule.onInstall(encodedConfig)
 *   2. approve  — USDC.approve(autopayModule, amount)
 *   3. execute  — ERC7579AutopayModule.execute(paymentAccount, amount)
 *
 * The txHash from step 3 must then be submitted to POST /platform/tier/confirm.
 */
export async function postTierPrepare(c: Context) {
  const auth = await requireTeamRoles(c, ["OWNER"]);
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any);

  const body = await c.req.json().catch(() => ({}));
  const parsed = prepareSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { ok: false, error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      400 as any,
    );
  }

  const { targetTier, paymentAccount } = parsed.data;

  try {
    const preparedData = await preparePlatformTierActivation({
      targetTier: targetTier as PlatformTier,
      paymentAccount,
    });

    return c.json({ ok: true, data: preparedData });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[platform/tier/prepare] Prepare failed:", message);

    // Distinguish "not bootstrapped" from other errors for a cleaner UI
    if (message.includes("not bootstrapped")) {
      return c.json({ ok: false, error: "BOOTSTRAP_MISSING", message }, 422 as any);
    }

    return c.json({ ok: false, error: "Prepare failed", message }, 500 as any);
  }
}
